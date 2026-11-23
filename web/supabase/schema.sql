-- Run once in a new Supabase project's SQL editor. Public anon/publishable key in the app only.
-- No extensions or service_role key are needed in the browser.
begin;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '', created_at timestamptz not null default now()
);
create table public.devices (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  firmware_device_id text not null, name text not null, created_at timestamptz not null default now(),
  unique(owner_id,firmware_device_id)
);
-- Device rows are a user's registry, not proof of physical pairing or firmware authorization.
-- Actual ownership pairing requires a physical challenge/claim flow in the firmware or trusted gateway.
create table public.sessions (
  id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null, started_at timestamptz not null, state text not null check(state in ('idle','calibrating','ready','training','stopped','completed','error')),
  muscle text not null check(muscle in ('forearm','biceps')), channel int not null check(channel in (1,2)),
  source text not null check(source in ('simulation','replay','sensor')), target int not null check(target between 1 and 1000),
  valid_count int not null check(valid_count>=0), total_count int not null check(total_count>=valid_count),
  duration_ms bigint not null check(duration_ms>=0), revision bigint not null default 0,
  payload jsonb not null, deleted_at timestamptz, updated_at timestamptz not null default now(),
  unique(id,owner_id)
);
create index sessions_owner_started on public.sessions(owner_id,started_at desc);
create table public.repetitions (
  id uuid primary key, session_id uuid not null, owner_id uuid not null references auth.users(id) on delete cascade,
  ordinal int not null check(ordinal>0), ended_ms bigint not null check(ended_ms>=0), hold_ms bigint not null check(hold_ms>=0), valid boolean not null,
  foreign key (session_id,owner_id) references public.sessions(id,owner_id) on delete cascade,
  unique(session_id,ordinal)
);
create index repetitions_session on public.repetitions(session_id);
create table public.signal_files (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null, object_path text not null unique, size_bytes bigint not null check(size_bytes between 0 and 10485760),
  created_at timestamptz not null default now(),
  foreign key(session_id,owner_id) references public.sessions(id,owner_id) on delete cascade
);
create function public.new_semg_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id) values(new.id) on conflict do nothing;return new;end;$$;
create trigger semg_user_created after insert on auth.users for each row execute function public.new_semg_profile();
insert into public.profiles(id) select id from auth.users on conflict do nothing;
-- Updated_at comes from PostgreSQL. Monotonic revision + immutable owner protect retries.
create function public.protect_semg_session() returns trigger language plpgsql set search_path=public as $$
begin
  if new.owner_id<>old.owner_id then raise exception 'Session owner is immutable';end if;
  if old.deleted_at is not null and new.deleted_at is null then raise exception 'Session was deleted';end if;
  if new.revision<old.revision then raise exception 'Stale session revision';end if;
  new.updated_at=now();return new;
end;$$;
create trigger semg_session_updated before update on public.sessions for each row execute function public.protect_semg_session();
alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.sessions enable row level security;
alter table public.repetitions enable row level security;
alter table public.signal_files enable row level security;
create policy profiles_select on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy devices_own on public.devices for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy sessions_own on public.sessions for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy repetitions_own on public.repetitions for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()) and exists(select 1 from public.sessions s where s.id=session_id and s.owner_id=(select auth.uid())));
create policy signals_own on public.signal_files for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()) and split_part(object_path,'/',1)=(select auth.uid())::text and exists(select 1 from public.sessions s where s.id=session_id and s.owner_id=(select auth.uid())));
grant select,update on public.profiles to authenticated;
grant select,insert,update,delete on public.devices,public.sessions,public.repetitions,public.signal_files to authenticated;
-- A private Storage bucket. Raw capture is not enabled in the first version.
insert into storage.buckets(id,name,public,file_size_limit) values('signals','signals',false,10485760) on conflict(id) do nothing;
create policy semg_storage_read on storage.objects for select to authenticated using(bucket_id='signals' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy semg_storage_insert on storage.objects for insert to authenticated with check(bucket_id='signals' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.sessions s where s.owner_id=(select auth.uid()) and s.id::text=(storage.foldername(name))[2] and s.deleted_at is null));
create policy semg_storage_delete on storage.objects for delete to authenticated using(bucket_id='signals' and (storage.foldername(name))[1]=(select auth.uid())::text);
commit;
