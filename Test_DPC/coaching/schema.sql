-- ============================================================
--  Delhi//PadelCollective — Coaching booking schema v2
--  Run this in the Supabase SQL editor.
--
--  PRICING MODEL (open groups):
--    Each coach has one fixed session_price. The first booker of
--    a slot picks the format (1:1 / 1:2 / 1:3), which sets the
--    slot's capacity; everyone (including later joiners) pays
--    session_price / capacity. A slot is full when spots_taken
--    reaches capacity.
-- ============================================================

create extension if not exists "pgcrypto";

-- ── Locations ───────────────────────────────────────────────
create table locations (
  id        text primary key,
  name      text not null,
  area      text,
  address   text,
  maps_url  text,
  courts    int  not null default 1,
  active    boolean not null default true
);

-- ── Coaches ─────────────────────────────────────────────────
create table coaches (
  id            text primary key,
  name          text not null,
  bio           text,
  photo         text,
  experience    text,
  level         text,
  specialty     text,
  languages     text,
  rating        numeric(2,1) not null default 5.0,
  reviews       int not null default 0,
  session_price numeric(10,2) not null,   -- full session price, split by group size
  active        boolean not null default true
);

create table coach_locations (
  coach_id    text references coaches(id) on delete cascade,
  location_id text references locations(id) on delete cascade,
  primary key (coach_id, location_id)
);

-- ── Slots ───────────────────────────────────────────────────
-- Generate these from each coach's weekly availability (admin task /
-- scheduled job). status: open | full | blocked | completed | cancelled
create table slots (
  id           uuid primary key default gen_random_uuid(),
  coach_id     text not null references coaches(id),
  location_id  text not null references locations(id),
  date         date not null,
  start_time   time not null,
  end_time     time not null,
  session_type text,                    -- null until the first booker picks the format
  capacity     int  not null default 0, -- set when claimed (1 / 2 / 3)
  spots_taken  int  not null default 0, -- confirmed (paid) spots
  status       text not null default 'open',
  unique (coach_id, date, start_time)
);
create index slots_lookup on slots (coach_id, location_id, date);

-- ── Bookings ────────────────────────────────────────────────
-- One row per PERSON (spot), not per session.
create table bookings (
  id              uuid primary key default gen_random_uuid(),
  booking_id      text unique not null,          -- human-readable, e.g. DPC-AB123456
  slot_id         uuid not null references slots(id),
  coach_id        text not null references coaches(id),
  location_id     text not null references locations(id),
  player_name     text not null,
  phone           text not null,
  email           text not null,
  skill_level     text,
  special_request text,
  session_type    text not null,                 -- 1:1 | 1:2 | 1:3
  players         int  not null default 1,       -- group capacity for this format
  amount          numeric(10,2) not null,        -- this person's share only
  payment_status  text not null default 'pending',   -- pending | paid | refunded | failed
  booking_status  text not null default 'pending',   -- pending | confirmed | cancelled | completed
  created_at      timestamptz not null default now()
);
create index bookings_phone on bookings (phone);
create index bookings_slot on bookings (slot_id);

-- ── Payments ────────────────────────────────────────────────
create table payments (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references bookings(id),
  razorpay_order_id   text unique not null,
  razorpay_payment_id text,
  signature           text,
  amount              numeric(10,2) not null,
  status              text not null default 'created',  -- created | paid | failed | refunded
  created_at          timestamptz not null default now()
);

-- ── RLS ─────────────────────────────────────────────────────
-- The anon key may only READ catalog data + slot availability.
-- All writes go through the edge functions (service role).
alter table locations       enable row level security;
alter table coaches         enable row level security;
alter table coach_locations enable row level security;
alter table slots           enable row level security;
alter table bookings        enable row level security;
alter table payments        enable row level security;

create policy "public read locations" on locations       for select using (active);
create policy "public read coaches"   on coaches         for select using (active);
create policy "public read coach_loc" on coach_locations for select using (true);
create policy "public read slots"     on slots           for select using (true);
-- no anon policies on bookings/payments: lookups go through the RPC below

-- ── Booking lookup by phone (avoids exposing the whole table) ──
create or replace function bookings_by_phone(p_phone text)
returns table (
  booking_id text, coach_name text, location_name text,
  date date, start_time time, amount numeric, booking_status text
)
language sql security definer set search_path = public as $$
  select b.booking_id, c.name, l.name, s.date, s.start_time, b.amount, b.booking_status
  from bookings b
  join coaches c on c.id = b.coach_id
  join locations l on l.id = b.location_id
  join slots s on s.id = b.slot_id
  where b.phone = p_phone and b.booking_status <> 'cancelled'
  order by s.date desc, s.start_time desc
  limit 20;
$$;

-- ── Atomic spot hold (called by create-order edge function) ──
-- Claims the slot's format on first booking, then checks a spot is
-- free counting both paid spots and pending (unexpired, <10 min old)
-- bookings, so two people can't pay for the last spot at once.
create or replace function hold_spot(p_slot_id uuid, p_type text, p_capacity int)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  s slots%rowtype;
  pending int;
begin
  select * into s from slots where id = p_slot_id for update;
  if not found or s.status not in ('open') then return false; end if;

  if s.session_type is null then
    update slots set session_type = p_type, capacity = p_capacity where id = p_slot_id;
    s.capacity := p_capacity;
  elsif s.session_type <> p_type then
    return false;  -- format already fixed by the first booker
  end if;

  select count(*) into pending
    from bookings
   where slot_id = p_slot_id
     and booking_status = 'pending'
     and created_at > now() - interval '10 minutes';

  return s.spots_taken + pending < s.capacity;
end;
$$;

-- ── Confirm a paid spot (called by verify-payment) ──────────
create or replace function confirm_spot(p_slot_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update slots
     set spots_taken = spots_taken + 1,
         status = case when spots_taken + 1 >= capacity then 'full' else status end
   where id = p_slot_id;
end;
$$;

-- ── Seed data ───────────────────────────────────────────────
insert into locations (id, name, area, courts) values
  ('loc-sirifort',   'Siri Fort',    'South Delhi',     2),
  ('loc-rackonnect', 'Rackonnect',   'Greater Kailash', 3),
  ('loc-vasant',     'Vasant Vihar', 'West Delhi',      1),
  ('loc-gurgaon',    'Gurgaon',      'Sector 43',       4);

insert into coaches (id, name, experience, level, specialty, languages, rating, reviews, session_price) values
  ('coach-prannay', 'Prannay Merchant', '8 yrs',  'Advanced Coach',          'Attack & net play',       'English, Hindi',          4.9, 62, 4800),
  ('coach-aditi',   'Aditi Rao',        '5 yrs',  'Intermediate & Beginner', 'Fundamentals & footwork', 'English, Hindi',          4.8, 41, 3600),
  ('coach-karan',   'Karan Bhatia',     '10 yrs', 'Advanced Coach',          'Match strategy & lobs',   'English, Hindi, Punjabi', 5.0, 28, 5400);

insert into coach_locations values
  ('coach-prannay', 'loc-sirifort'), ('coach-prannay', 'loc-rackonnect'), ('coach-prannay', 'loc-gurgaon'),
  ('coach-aditi',   'loc-sirifort'), ('coach-aditi',   'loc-vasant'),
  ('coach-karan',   'loc-gurgaon'),  ('coach-karan',   'loc-rackonnect');
