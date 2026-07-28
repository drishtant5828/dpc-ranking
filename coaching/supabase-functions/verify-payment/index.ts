// ============================================================
//  verify-payment — Supabase Edge Function
//
//  Verifies the Razorpay payment signature (HMAC-SHA256 of
//  "order_id|payment_id" with the key secret) and only then
//  marks the booking confirmed and the slot booked.
//
//  Deploy:  supabase functions deploy verify-payment
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function hmacSha256Hex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return json({ error: "Missing payment fields" }, 400);
    }

    // Verify signature — the only proof of payment we trust.
    const expected = await hmacSha256Hex(
      Deno.env.get("RAZORPAY_KEY_SECRET")!,
      `${razorpay_order_id}|${razorpay_payment_id}`,
    );
    if (expected !== razorpay_signature) {
      return json({ error: "Invalid payment signature" }, 400);
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Locate the payment + booking created by create-order.
    const { data: payment, error: payErr } = await db
      .from("payments").select("*").eq("razorpay_order_id", razorpay_order_id).single();
    if (payErr || !payment) return json({ error: "Order not found" }, 404);

    await db.from("payments").update({
      razorpay_payment_id, signature: razorpay_signature, status: "paid",
    }).eq("id", payment.id);

    const { data: booking, error: bookErr } = await db
      .from("bookings")
      .update({ payment_status: "paid", booking_status: "confirmed" })
      .eq("id", payment.booking_id)
      .select("*, coaches(name), locations(name), slots(date, start_time, end_time)")
      .single();
    if (bookErr) return json({ error: bookErr.message }, 500);

    // Take the spot; marks the slot full when the group is complete.
    await db.rpc("confirm_spot", { p_slot_id: booking.slot_id });
    const { data: slot } = await db
      .from("slots").select("capacity, spots_taken").eq("id", booking.slot_id).single();

    return json({
      booking_id: booking.booking_id,
      coach_name: booking.coaches?.name,
      location_name: booking.locations?.name,
      date: booking.slots?.date,
      start_time: booking.slots?.start_time,
      end_time: booking.slots?.end_time,
      session_type: booking.session_type,
      players: booking.players,
      capacity: slot?.capacity,
      spots_taken: slot?.spots_taken,
      amount: booking.amount,
      payment_status: "paid",
      booking_status: "confirmed",
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
