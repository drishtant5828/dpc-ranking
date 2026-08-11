# DPC Coaching — Booking Platform (v1)

Player-facing booking flow: **location → coach → date/slot → session type → details → review → Razorpay → confirmed**.

## Pricing model (open groups)

Each coach has one fixed `session_price` (e.g. ₹4,800/hour). The per-person price
is that split by group size: 1:1 → ₹4,800 · 1:2 → ₹2,400 each · 1:3 → ₹1,600 each.
The **first booker** of a slot picks the format and pays only their own share;
the remaining spots stay open for anyone to join at the same per-person price
until the group is full. One booking row = one person's spot.

## Files

- `index.html` — the booking page (static, matches site design, mobile-first)
- `config.js` — Supabase/Razorpay config + data layer (runs in **demo mode** until configured)
- `schema.sql` — database schema, RLS policies, seed data (run in Supabase SQL editor)
- `supabase-functions/create-order` — holds the slot, recomputes price server-side, creates Razorpay order
- `supabase-functions/verify-payment` — verifies the Razorpay HMAC signature, then confirms the booking

## Demo mode

Out of the box (no credentials), the page uses sample coaches/locations/slots and a
simulated payment, so the full flow can be tested end-to-end. A "Demo Mode" pill
shows in the header.

## Go live

1. **Supabase**: create a project → run `schema.sql` in the SQL editor → paste the
   project URL and anon key into `config.js`.
2. **Edge functions**:
   ```sh
   supabase functions deploy create-order
   supabase functions deploy verify-payment
   supabase secrets set RAZORPAY_KEY_ID=rzp_live_xxx RAZORPAY_KEY_SECRET=xxx
   ```
3. **Razorpay**: paste the public key id into `config.js` (`RAZORPAY_KEY_ID`).
4. **Slots**: insert rows into `slots` for each coach's availability (an admin
   generator page is the next build item).

## Payment integrity

- The share is recomputed server-side in `create-order` from the coach's
  `session_price` — the client-sent amount is never trusted.
- `hold_spot()` atomically claims the slot format and holds one spot (pending
  bookings under 10 minutes old count against capacity), so two people can't
  pay for the last spot at once.
- A booking is only confirmed after `verify-payment` validates the Razorpay
  signature server-side; `confirm_spot()` then marks the slot full when the
  group is complete.

## Not in v1 (next)

Admin dashboard (slot generation, refunds, reports), coach portal, WhatsApp/email
notifications, promo codes, peak/weekend pricing.
