-- Run once in Supabase: SQL Editor → New query → paste → Run.

-- 1. Table for facilities, QR points and photo records (one row per record).
create table if not exists public.wf_docs (
  col        text        not null,
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
-- Only the app's server (secret key) can read or write. Browsers never talk to Supabase directly.
alter table public.wf_docs enable row level security;

-- 2. Public bucket for station photos (passengers' phones load these directly).
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

-- 3. Private bucket for gate-duty selfies and passenger photos (the app also creates it on first use).
--    Not public: photos are only served to signed-in staff through /api/pfile.
insert into storage.buckets (id, name, public)
values ('private', 'private', false)
on conflict (id) do update set public = false;
