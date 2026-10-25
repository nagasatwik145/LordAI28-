alter table public.autopilot_missions
  add column if not exists events jsonb not null default '[]'::jsonb,
  add column if not exists idempotency_key uuid,
  add column if not exists approved_scope_hash text;

-- The ordered plan JSON stores per-step state, timestamps, and retry metadata.
alter table public.autopilot_missions
  add constraint autopilot_missions_events_array
  check (jsonb_typeof(events) = 'array');

create unique index if not exists autopilot_missions_user_idempotency_idx
  on public.autopilot_missions (user_id, idempotency_key)
  where idempotency_key is not null;
