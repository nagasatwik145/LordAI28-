create table if not exists public.developer_lab_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  action text not null check (action in ('explain', 'debug', 'refactor', 'tests', 'security', 'document')),
  language text not null check (char_length(language) between 1 and 40),
  code text not null check (char_length(code) <= 40000),
  output text not null check (char_length(output) <= 40000),
  created_at timestamptz not null default now()
);

create index if not exists developer_lab_sessions_user_created_idx
  on public.developer_lab_sessions (user_id, created_at desc);

alter table public.developer_lab_sessions enable row level security;
revoke all on public.developer_lab_sessions from anon;
grant select, insert, delete on public.developer_lab_sessions to authenticated;

create policy "Users can read their own Developer Lab sessions"
  on public.developer_lab_sessions for select
  using (auth.uid() = user_id);

create policy "Users can create their own Developer Lab sessions"
  on public.developer_lab_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own Developer Lab sessions"
  on public.developer_lab_sessions for delete
  using (auth.uid() = user_id);
