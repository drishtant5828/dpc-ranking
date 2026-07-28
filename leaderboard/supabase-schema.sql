-- ============================================================
--  Delhi//PadelCollective — Leaderboard cache (Supabase)
--  Run this once in the Supabase SQL editor.
--
--  Design: a JSON passthrough cache. Each of the 4 leaderboard
--  Apps Script endpoints returns its own (messy, inconsistent)
--  JSON. Rather than model every column, we store each endpoint's
--  raw JSON response as one row. The Apps Script sync writes these
--  rows; the website reads them in a single fast REST call and
--  runs its existing client-side normalizers unchanged.
-- ============================================================

create table leaderboard_cache (
  source     text primary key,          -- 'firstServe' | 'breakPoint' | 'matchPoint' | 'noida'
  payload    jsonb not null,            -- the exact JSON that endpoint returns
  updated_at timestamptz not null default now()
);

-- Anyone (the website's anon key) may READ the cache.
-- Writes happen only via the service-role key inside Apps Script,
-- which bypasses RLS — so no write policy is defined here.
alter table leaderboard_cache enable row level security;

create policy "public read leaderboard cache"
  on leaderboard_cache for select using (true);
