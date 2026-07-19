-- NZ Drive Practice - Supabase Schema
-- Run this in the Supabase SQL editor to set up the database

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Sessions table
create table if not exists public.sessions (
  id text primary key,
  user_id uuid not null,
  start_time timestamptz not null,
  end_time timestamptz,
  duration_seconds integer not null default 0,
  total_distance_meters integer not null default 0,
  average_speed_kmh integer not null default 0,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  score jsonb,
  feedback text,
  created_at timestamptz not null default now()
);

-- GPS tracks (spatial data per session)
create table if not exists public.gps_tracks (
  id bigserial primary key,
  session_id text not null references public.sessions(id) on delete cascade,
  sequence integer not null,
  latitude double precision not null,
  longitude double precision not null,
  speed_ms real not null default 0,
  heading real not null default 0,
  recorded_at timestamptz not null
);

-- Hazard detection events
create table if not exists public.hazard_events (
  id text primary key,
  session_id text not null references public.sessions(id) on delete cascade,
  occurred_at timestamptz not null,
  latitude double precision not null,
  longitude double precision not null,
  prompt text not null,
  response text not null,
  detected_correctly boolean,
  created_at timestamptz not null default now()
);

-- AI proxy usage log (rate limiting + cost telemetry — see ADR-0001)
-- Written only by the ai-proxy Edge Function via the service role; no client access.
create table if not exists public.ai_usage (
  id bigserial primary key,
  user_id uuid not null,
  provider text not null,
  status integer not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_user_created_idx on public.ai_usage(user_id, created_at desc);

alter table public.ai_usage enable row level security;
-- No policies on purpose: service role bypasses RLS; clients get nothing.

-- Indexes
create index if not exists sessions_user_id_idx on public.sessions(user_id);
create index if not exists sessions_start_time_idx on public.sessions(start_time desc);
create index if not exists gps_tracks_session_id_idx on public.gps_tracks(session_id);
create index if not exists gps_tracks_sequence_idx on public.gps_tracks(session_id, sequence);
create index if not exists hazard_events_session_id_idx on public.hazard_events(session_id);

-- Row Level Security
alter table public.sessions enable row level security;
alter table public.gps_tracks enable row level security;
alter table public.hazard_events enable row level security;

-- RLS Policies: users can only access their own data
create policy "Users see own sessions"
  on public.sessions for all
  using (auth.uid() = user_id);

create policy "Users see own GPS tracks"
  on public.gps_tracks for all
  using (
    exists (
      select 1 from public.sessions s
      where s.id = gps_tracks.session_id and s.user_id = auth.uid()
    )
  );

create policy "Users see own hazard events"
  on public.hazard_events for all
  using (
    exists (
      select 1 from public.sessions s
      where s.id = hazard_events.session_id and s.user_id = auth.uid()
    )
  );
