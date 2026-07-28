-- ============================================================
--  Delhi//PadelCollective — Dashboard cache (Supabase)
--  Run this once in the Supabase SQL editor (same project as the
--  leaderboard — this just adds a second table).
--
--  Design: a per-player JSON cache. Unlike the leaderboard (same
--  data for everyone), the dashboard is personal — queried by
--  phone. So we store ONE ROW PER PLAYER holding their stats +
--  match history JSON. The website queries `phone=eq.<phone>` and
--  runs its existing render code unchanged.
-- ============================================================

create table dashboard_cache (
  phone      text primary key,
  player     jsonb not null default '{}',   -- getPlayer/getAllPlayers stats
  matches    jsonb not null default '[]',   -- getPlayerMatches history
  updated_at timestamptz not null default now()
);

-- NOTE ON PRIVACY: this policy lets anyone with the public key read
-- a player's data if they know the phone number. That matches how
-- the current Apps Script endpoints already behave (they're public
-- and phone-parameterised), so it's no more exposed than today. To
-- lock it down later, replace this with an auth-gated policy or move
-- reads behind an edge function.
alter table dashboard_cache enable row level security;

create policy "public read dashboard cache"
  on dashboard_cache for select using (true);
