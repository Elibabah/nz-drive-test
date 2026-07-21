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

-- ═══════════════════════════════════════════════════════════════════════════
-- Schema v2 (MVP-0): every event type persisted + incremental checkpointing
-- Re-runnable: guarded creates, drop-and-recreate policies.
-- ═══════════════════════════════════════════════════════════════════════════

-- v1 had a bare uuid — cascade account deletion properly
alter table public.sessions drop constraint if exists sessions_user_id_fkey;
alter table public.sessions
  add constraint sessions_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- Idempotent GPS checkpointing: replaying a chunk must not duplicate points
create unique index if not exists gps_tracks_session_sequence_key
  on public.gps_tracks(session_id, sequence);

-- v1 hazard_events lacked the AI evaluation
alter table public.hazard_events add column if not exists evaluation_quality text
  check (evaluation_quality in ('good', 'partial', 'missed'));
alter table public.hazard_events add column if not exists evaluation_feedback text;

create table if not exists public.knowledge_events (
  id text primary key,
  session_id text not null references public.sessions(id) on delete cascade,
  occurred_at timestamptz not null,
  latitude double precision not null,
  longitude double precision not null,
  question text not null,
  expected_answer text not null,
  response text not null default '',
  evaluation_quality text check (evaluation_quality in ('correct', 'partial', 'incorrect')),
  evaluation_feedback text,
  created_at timestamptz not null default now()
);

create table if not exists public.decision_events (
  id text primary key,
  session_id text not null references public.sessions(id) on delete cascade,
  occurred_at timestamptz not null,
  latitude double precision not null,
  longitude double precision not null,
  trigger text not null check (trigger in ('off_route', 'stop_complied', 'speed_change')),
  question text not null,
  response text not null default '',
  evaluation_quality text check (evaluation_quality in ('good', 'poor')),
  evaluation_feedback text,
  created_at timestamptz not null default now()
);

create table if not exists public.speed_violations (
  id text primary key,
  session_id text not null references public.sessions(id) on delete cascade,
  occurred_at timestamptz not null,
  latitude double precision not null,
  longitude double precision not null,
  speed_kmh integer not null,
  limit_kmh integer not null,
  severity text not null check (severity in ('critical', 'immediate_fail')),
  duration_seconds integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.stop_events (
  id text primary key,
  session_id text not null references public.sessions(id) on delete cascade,
  occurred_at timestamptz not null,
  latitude double precision not null,
  longitude double precision not null,
  type text not null check (type in ('stop_sign', 'railway_crossing', 'pedestrian_crossing')),
  complied boolean not null,
  lowest_speed_kmh integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.braking_events (
  id text primary key,
  session_id text not null references public.sessions(id) on delete cascade,
  occurred_at timestamptz not null,
  latitude double precision not null,
  longitude double precision not null,
  speed_from_kmh integer not null,
  speed_to_kmh integer not null,
  delta_kmh integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.navigation_events (
  id text primary key,
  session_id text not null references public.sessions(id) on delete cascade,
  occurred_at timestamptz not null,
  latitude double precision not null,
  longitude double precision not null,
  instruction_given text not null,
  type text not null check (type in ('wrong_turn', 'off_route')),
  created_at timestamptz not null default now()
);

create index if not exists knowledge_events_session_id_idx on public.knowledge_events(session_id);
create index if not exists decision_events_session_id_idx on public.decision_events(session_id);
create index if not exists speed_violations_session_id_idx on public.speed_violations(session_id);
create index if not exists stop_events_session_id_idx on public.stop_events(session_id);
create index if not exists braking_events_session_id_idx on public.braking_events(session_id);
create index if not exists navigation_events_session_id_idx on public.navigation_events(session_id);

-- ─── Row Level Security ──────────────────────────────────────────────────────
-- Explicit per-operation policies with WITH CHECK (v1 used FOR ALL + USING).
-- Ownership of event rows derives from the owning session.

alter table public.sessions enable row level security;
alter table public.gps_tracks enable row level security;
alter table public.hazard_events enable row level security;
alter table public.knowledge_events enable row level security;
alter table public.decision_events enable row level security;
alter table public.speed_violations enable row level security;
alter table public.stop_events enable row level security;
alter table public.braking_events enable row level security;
alter table public.navigation_events enable row level security;

drop policy if exists "Users see own sessions" on public.sessions;
drop policy if exists "sessions select own" on public.sessions;
drop policy if exists "sessions insert own" on public.sessions;
drop policy if exists "sessions update own" on public.sessions;
create policy "sessions select own" on public.sessions
  for select using (auth.uid() = user_id);
create policy "sessions insert own" on public.sessions
  for insert with check (auth.uid() = user_id);
create policy "sessions update own" on public.sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Event-table policies are identical in shape; generate them once per table
do $$
declare t text;
begin
  foreach t in array array[
    'gps_tracks', 'hazard_events', 'knowledge_events', 'decision_events',
    'speed_violations', 'stop_events', 'braking_events', 'navigation_events'
  ] loop
    execute format('drop policy if exists "Users see own GPS tracks" on public.%I', t);
    execute format('drop policy if exists "Users see own hazard events" on public.%I', t);
    execute format('drop policy if exists "%s select own" on public.%I', t, t);
    execute format('drop policy if exists "%s insert own" on public.%I', t, t);
    execute format('drop policy if exists "%s update own" on public.%I', t, t);
    execute format(
      'create policy "%s select own" on public.%I for select using (
         exists (select 1 from public.sessions s where s.id = %I.session_id and s.user_id = auth.uid()))',
      t, t, t);
    execute format(
      'create policy "%s insert own" on public.%I for insert with check (
         exists (select 1 from public.sessions s where s.id = %I.session_id and s.user_id = auth.uid()))',
      t, t, t);
    execute format(
      'create policy "%s update own" on public.%I for update
         using (exists (select 1 from public.sessions s where s.id = %I.session_id and s.user_id = auth.uid()))
         with check (exists (select 1 from public.sessions s where s.id = %I.session_id and s.user_id = auth.uid()))',
      t, t, t, t);
  end loop;
end $$;
