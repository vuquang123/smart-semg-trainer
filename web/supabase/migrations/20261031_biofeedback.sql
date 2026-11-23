-- Existing installations: allow explicitly labelled replay and firmware targets.
-- Does not change RLS, owners or existing session payloads.
begin;
alter table public.sessions drop constraint if exists sessions_source_check;
alter table public.sessions add constraint sessions_source_check check (source in ('simulation','replay','sensor'));
alter table public.sessions drop constraint if exists sessions_target_check;
alter table public.sessions add constraint sessions_target_check check (target between 1 and 1000);
commit;
