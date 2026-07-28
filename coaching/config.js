// ============================================================
//  Delhi//PadelCollective — Coaching config.js v2
//
//  Data layer for the coaching booking platform.
//
//  PRICING MODEL (open groups):
//   Each coach has one fixed session_price (e.g. ₹4800/hour).
//   The per-person price is that split by group size:
//     1:1 → ₹4800 · 1:2 → ₹2400 each · 1:3 → ₹1600 each
//   The FIRST booker of a slot picks the format (1:1 / 1:2 / 1:3)
//   and pays only their own share. Remaining spots stay open for
//   anyone to join at the same per-person price until the group
//   is full.
//
//  SETUP (go-live checklist):
//   1. Create a Supabase project, run coaching/schema.sql in the
//      SQL editor, then paste your project URL + anon key below.
//   2. Deploy the two edge functions in coaching/supabase-functions/
//      (create-order, verify-payment) with your Razorpay keys set
//      as secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET.
//   3. Paste your Razorpay key id below (public key only —
//      the secret lives ONLY in the edge functions).
//
//  Until step 1 is done the page runs in DEMO MODE with sample
//  coaches/slots and a simulated payment, so the full flow can
//  be tested end-to-end without any credentials.
// ============================================================

const CONFIG = {
  SUPABASE_URL: "YOUR_SUPABASE_URL",        // e.g. https://abcd1234.supabase.co
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY",
  RAZORPAY_KEY_ID: "YOUR_RAZORPAY_KEY_ID",  // e.g. rzp_live_xxxxxxxx
  CANCEL_WINDOW_HOURS: 12,                  // players may cancel up to N hours before start
};

const DEMO_MODE = CONFIG.SUPABASE_URL.startsWith("YOUR_");

// ── Session types ───────────────────────────────────────────
// Per-person price = coach.session_price / players.
const SESSION_TYPES = [
  { id: "1:1", label: "1:1 Private", players: 1 },
  { id: "1:2", label: "1:2 Duo",     players: 2 },
  { id: "1:3", label: "1:3 Trio",    players: 3 },
];

function sharePrice(sessionPrice, typeId) {
  const t = SESSION_TYPES.find(x => x.id === typeId);
  return Math.round(sessionPrice / t.players);
}

// ── Demo data ───────────────────────────────────────────────
const DEMO = {
  locations: [
    { id: "loc-sirifort",  name: "Siri Fort",     area: "South Delhi", courts: 2, maps_url: "https://maps.google.com/?q=Siri+Fort+Sports+Complex" },
    { id: "loc-rackonnect",name: "Rackonnect",    area: "Greater Kailash", courts: 3, maps_url: "https://maps.google.com/?q=Rackonnect+GK" },
    { id: "loc-vasant",    name: "Vasant Vihar",  area: "West Delhi",  courts: 1, maps_url: "https://maps.google.com/?q=Vasant+Vihar+Delhi" },
    { id: "loc-gurgaon",   name: "Gurgaon",       area: "Sector 43",   courts: 4, maps_url: "https://maps.google.com/?q=Gurgaon+padel" },
  ],
  coaches: [
    {
      id: "coach-prannay", name: "Prannay Merchant", rating: 4.9, reviews: 62,
      experience: "8 yrs", level: "Advanced Coach",
      specialty: "Attack & net play", languages: "English, Hindi",
      bio: "Former national-circuit player. Focuses on aggressive net positioning and smash mechanics.",
      photo: "", locations: ["loc-sirifort", "loc-rackonnect", "loc-gurgaon"],
      session_price: 4800,
    },
    {
      id: "coach-aditi", name: "Aditi Rao", rating: 4.8, reviews: 41,
      experience: "5 yrs", level: "Intermediate & Beginner",
      specialty: "Fundamentals & footwork", languages: "English, Hindi",
      bio: "Loves building players from zero. Patient, drill-heavy sessions with video feedback.",
      photo: "", locations: ["loc-sirifort", "loc-vasant"],
      session_price: 3600,
    },
    {
      id: "coach-karan", name: "Karan Bhatia", rating: 5.0, reviews: 28,
      experience: "10 yrs", level: "Advanced Coach",
      specialty: "Match strategy & lobs", languages: "English, Hindi, Punjabi",
      bio: "Ex-tennis pro turned padel obsessive. Strategy-first coaching for competitive players.",
      photo: "", locations: ["loc-gurgaon", "loc-rackonnect"],
      session_price: 5400,
    },
  ],
  // Weekly template: coach id → weekday (0=Sun) → start times
  availability: {
    "coach-prannay": { 1: ["17:00","18:00","19:30"], 2: ["17:00","18:00"], 3: ["17:00","18:00","19:30","20:30"], 5: ["07:00","08:00","17:00"], 6: ["07:00","08:00","09:00"] },
    "coach-aditi":   { 0: ["08:00","09:00","10:00"], 2: ["18:00","19:00"], 4: ["17:00","18:00","19:00"], 6: ["16:00","17:00","18:00"] },
    "coach-karan":   { 1: ["07:00","08:00"], 3: ["07:00","08:00"], 4: ["18:30","19:30","20:30"], 5: ["18:30","19:30"], 0: ["17:00","18:00"] },
  },
};

// demo group state (slot id → {session_type, capacity, spots_taken}) + bookings,
// in-memory for the session
const _demoGroups = {};
const _demoBookings = [];

// Deterministic pseudo-random seed so the demo shows a mix of slot states
function _demoSeed(dateStr, time) {
  return (parseInt(dateStr.replace(/-/g, ""), 10) + parseInt(time, 10) * 7) % 10;
}

// ── Helpers ─────────────────────────────────────────────────
function toDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime12(t) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatDateLong(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
}

function genBookingId() {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `DPC-${Date.now().toString(36).toUpperCase().slice(-4)}${n}`;
}

// slot end time = start + 60 min
function endTimeOf(start) {
  const [h, m] = start.split(":").map(Number);
  const d = new Date(2000, 0, 1, h, m + 60);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── Supabase (live mode) ────────────────────────────────────
let _sb = null;
function sb() {
  if (!_sb) _sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  return _sb;
}

// ── API ─────────────────────────────────────────────────────
// Slot shape returned by fetchSlots:
//   { id, date, start_time, end_time,
//     session_type,   // null = unclaimed (first booker picks format)
//     capacity,       // 0 until claimed
//     spots_taken,    // paid spots
//     status }        // "open" | "full"
const API = {

  async fetchLocations() {
    if (DEMO_MODE) return DEMO.locations;
    const { data, error } = await sb().from("locations").select("*").eq("active", true).order("name");
    if (error) throw error;
    return data;
  },

  async fetchCoaches(locationId) {
    if (DEMO_MODE) return DEMO.coaches.filter(c => c.locations.includes(locationId));
    const { data, error } = await sb()
      .from("coaches")
      .select("*, coach_locations!inner(location_id)")
      .eq("active", true)
      .eq("coach_locations.location_id", locationId);
    if (error) throw error;
    return data;
  },

  // Returns { "YYYY-MM-DD": [slot, ...] } for the next `days` days.
  async fetchSlots(coachId, locationId, days = 14) {
    const today = new Date();
    const from = toDateStr(today);
    const until = toDateStr(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));

    if (DEMO_MODE) {
      const byDate = {};
      const tmpl = DEMO.availability[coachId] || {};
      for (let i = 1; i <= days; i++) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
        const times = tmpl[d.getDay()] || [];
        if (!times.length) continue;
        const dateStr = toDateStr(d);
        byDate[dateStr] = times.map(t => {
          const id = `${coachId}|${locationId}|${dateStr}|${t}`;
          // group state: session bookings first, else deterministic seed
          let g = _demoGroups[id];
          if (!g) {
            const seed = _demoSeed(dateStr, t);
            if (seed === 0)      g = { session_type: "1:1", capacity: 1, spots_taken: 1 }; // full
            else if (seed === 1) g = { session_type: "1:3", capacity: 3, spots_taken: 1 }; // join a trio
            else if (seed === 2) g = { session_type: "1:2", capacity: 2, spots_taken: 1 }; // join a duo
            else if (seed === 3) g = { session_type: "1:3", capacity: 3, spots_taken: 2 }; // last spot
            else                 g = { session_type: null,  capacity: 0, spots_taken: 0 }; // unclaimed
          }
          const full = g.capacity > 0 && g.spots_taken >= g.capacity;
          return { id, date: dateStr, start_time: t, end_time: endTimeOf(t), ...g, status: full ? "full" : "open" };
        });
      }
      return byDate;
    }

    const { data, error } = await sb()
      .from("slots")
      .select("*")
      .eq("coach_id", coachId)
      .eq("location_id", locationId)
      .gt("date", from)
      .lte("date", until)
      .neq("status", "blocked")
      .order("date").order("start_time");
    if (error) throw error;
    const byDate = {};
    for (const s of data) {
      const full = s.status !== "open" || (s.capacity > 0 && s.spots_taken >= s.capacity);
      (byDate[s.date] ??= []).push({ ...s, status: full ? "full" : "open" });
    }
    return byDate;
  },

  // Books ONE spot in the slot. If the slot is unclaimed, session_type
  // claims it and sets capacity. Amount = the booker's share only.
  // Resolves with the confirmed booking or rejects if payment fails.
  async createBooking(b) {
    if (DEMO_MODE) {
      // simulate Razorpay checkout latency + success
      await new Promise(r => setTimeout(r, 1400));
      const t = SESSION_TYPES.find(x => x.id === b.session_type);
      const g = _demoGroups[b.slot_id] || { session_type: b.session_type, capacity: t.players, spots_taken: b.spots_taken || 0 };
      g.session_type = b.session_type;
      g.capacity = t.players;
      g.spots_taken += 1;
      _demoGroups[b.slot_id] = g;
      const booking = {
        ...b, booking_id: genBookingId(),
        spots_taken: g.spots_taken, capacity: g.capacity,
        payment_status: "paid", booking_status: "confirmed",
        created_at: new Date().toISOString(), demo: true,
      };
      _demoBookings.push(booking);
      return booking;
    }

    // 1. create order server-side (also holds one spot in the slot)
    const orderRes = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}` },
      body: JSON.stringify(b),
    });
    const order = await orderRes.json();
    if (!orderRes.ok) throw new Error(order.error || "Could not create order");

    // 2. open Razorpay checkout
    const payment = await new Promise((resolve, reject) => {
      const rzp = new window.Razorpay({
        key: CONFIG.RAZORPAY_KEY_ID,
        amount: order.amount,
        currency: "INR",
        name: "Delhi Padel Collective",
        description: `Coaching — ${b.coach_name}`,
        order_id: order.razorpay_order_id,
        prefill: { name: b.player_name, email: b.email, contact: b.phone },
        theme: { color: "#CB5957" },
        handler: resolve,
        modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
      });
      rzp.on("payment.failed", (resp) => reject(new Error(resp.error?.description || "Payment failed")));
      rzp.open();
    });

    // 3. verify signature server-side; booking confirmed only after this
    const verifyRes = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/verify-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}` },
      body: JSON.stringify({
        razorpay_order_id: payment.razorpay_order_id,
        razorpay_payment_id: payment.razorpay_payment_id,
        razorpay_signature: payment.razorpay_signature,
      }),
    });
    const confirmed = await verifyRes.json();
    if (!verifyRes.ok) throw new Error(confirmed.error || "Payment verification failed");
    return confirmed;
  },

  // Look up bookings by phone (for "my sessions")
  async fetchBookings(phone) {
    if (DEMO_MODE) return _demoBookings.filter(b => b.phone === phone);
    const { data, error } = await sb().rpc("bookings_by_phone", { p_phone: phone });
    if (error) throw error;
    return data;
  },
};
