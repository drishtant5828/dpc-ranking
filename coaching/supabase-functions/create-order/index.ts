// ============================================================
//  create-order — Supabase Edge Function
//
//  Books ONE spot in a slot (open-group model). Recomputes the
//  booker's share server-side (session_price / group size), holds
//  the spot, creates a pending booking + a Razorpay order, and
//  returns the order id to the frontend for checkout.
//
//  Deploy:  supabase functions deploy create-order
//  Secrets: supabase secrets set RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=...
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const TYPE_PLAYERS: Record<string, number> = { "1:1": 1, "1:2": 2, "1:3": 3 };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function genBookingId() {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `DPC-${Date.now().toString(36).toUpperCase().slice(-4)}${n}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const b = await req.json();
    for (const f of ["slot_id", "coach_id", "location_id", "session_type", "player_name", "phone", "email"]) {
      if (!b[f]) return json({ error: `Missing field: ${f}` }, 400);
    }
    const capacity = TYPE_PLAYERS[b.session_type];
    if (!capacity) return json({ error: "Invalid session type" }, 400);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Recompute the share server-side — never trust the client's price.
    const { data: coach, error: coachErr } = await db
      .from("coaches").select("session_price").eq("id", b.coach_id).single();
    if (coachErr || !coach) return json({ error: "Coach not found" }, 404);
    const amount = Math.round(Number(coach.session_price) / capacity);

    // 2. Atomically hold one spot (claims the format if slot is unclaimed;
    //    fails if the group format differs or the slot is full).
    const { data: held, error: holdErr } = await db.rpc("hold_spot", {
      p_slot_id: b.slot_id, p_type: b.session_type, p_capacity: capacity,
    });
    if (holdErr) return json({ error: holdErr.message }, 500);
    if (!held) return json({ error: "This spot was just taken — please pick another slot." }, 409);

    // 3. Create pending booking (this is what holds the spot for 10 min).
    const booking_id = genBookingId();
    const { data: booking, error: bookErr } = await db.from("bookings").insert({
      booking_id,
      slot_id: b.slot_id,
      coach_id: b.coach_id,
      location_id: b.location_id,
      player_name: b.player_name,
      phone: b.phone,
      email: b.email,
      skill_level: b.skill_level || null,
      special_request: b.special_request || null,
      session_type: b.session_type,
      players: capacity,
      amount,
    }).select().single();
    if (bookErr) return json({ error: bookErr.message }, 500);

    // 4. Create Razorpay order (amount in paise).
    const auth = btoa(`${Deno.env.get("RAZORPAY_KEY_ID")}:${Deno.env.get("RAZORPAY_KEY_SECRET")}`);
    const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amount * 100, currency: "INR", receipt: booking_id }),
    });
    const order = await orderRes.json();
    if (!orderRes.ok) {
      // release the held spot
      await db.from("bookings").update({ booking_status: "cancelled", payment_status: "failed" }).eq("id", booking.id);
      return json({ error: order.error?.description || "Could not create payment order" }, 502);
    }

    await db.from("payments").insert({
      booking_id: booking.id,
      razorpay_order_id: order.id,
      amount,
      status: "created",
    });

    return json({ razorpay_order_id: order.id, amount: amount * 100, booking_id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
