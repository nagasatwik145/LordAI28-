create table if not exists public.lord_community_creations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  creator_id uuid not null references auth.users(id) on delete cascade,
  creator_slug text not null,
  creator_name text not null check (char_length(creator_name) between 1 and 80),
  source_type text not null check (source_type in ('game')),
  source_id uuid not null,
  title text not null check (char_length(title) between 3 and 100),
  description text not null check (char_length(description) between 10 and 2000),
  category text not null check (category in ('games','agents','templates','learning')),
  tags text[] not null default '{}',
  public_spec jsonb not null,
  version text not null default '1.0.0',
  status text not null default 'draft' check (status in ('draft','published','unpublished','removed')),
  moderation_status text not null default 'pending' check (moderation_status in ('pending','approved','rejected','removed')),
  helpful_count integer not null default 0 check (helpful_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  unique (creator_id, source_type, source_id)
);
create index if not exists lord_community_discovery_idx on public.lord_community_creations (published_at desc, id) where status = 'published' and moderation_status = 'approved';
create index if not exists lord_community_creator_idx on public.lord_community_creations (creator_id, updated_at desc);
create index if not exists lord_community_public_creator_idx on public.lord_community_creations (creator_slug, published_at desc) where status = 'published' and moderation_status = 'approved';
create index if not exists lord_community_category_idx on public.lord_community_creations (category, published_at desc) where status = 'published' and moderation_status = 'approved';
alter table public.lord_community_creations enable row level security;
create policy "Public can discover approved published community creations" on public.lord_community_creations for select using (status = 'published' and moderation_status = 'approved');
create policy "Creators can read their own community creations" on public.lord_community_creations for select to authenticated using (auth.uid() = creator_id);

create table if not exists public.lord_community_votes (
  creation_id uuid not null references public.lord_community_creations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (creation_id, user_id)
);
alter table public.lord_community_votes enable row level security;
create policy "Users can read their own community votes" on public.lord_community_votes for select to authenticated using (auth.uid() = user_id);
create policy "Users can vote once on published creations" on public.lord_community_votes for insert to authenticated with check (auth.uid() = user_id and exists (select 1 from public.lord_community_creations c where c.id = creation_id and c.status = 'published' and c.moderation_status = 'approved'));
create policy "Users can remove their own community vote" on public.lord_community_votes for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.lord_community_bookmarks (
  creation_id uuid not null references public.lord_community_creations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (creation_id, user_id)
);
alter table public.lord_community_bookmarks enable row level security;
create policy "Users manage their own community bookmarks" on public.lord_community_bookmarks for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id and exists (select 1 from public.lord_community_creations c where c.id = creation_id and c.status = 'published' and c.moderation_status = 'approved'));

create table if not exists public.lord_community_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  creation_id uuid references public.lord_community_creations(id) on delete cascade,
  reported_user_id uuid references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam','harmful','copyright','privacy','other')),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now(),
  check ((creation_id is not null) <> (reported_user_id is not null))
);
create index if not exists lord_community_reports_queue_idx on public.lord_community_reports (status, created_at desc);
alter table public.lord_community_reports enable row level security;
create policy "Users can submit reports" on public.lord_community_reports for insert to authenticated with check (auth.uid() = reporter_id);
create policy "Users can see their submitted reports" on public.lord_community_reports for select to authenticated using (auth.uid() = reporter_id);

grant select on public.lord_community_creations to authenticated;
grant select on public.lord_community_creations to anon;
grant select, insert, delete on public.lord_community_votes to authenticated;
grant select, insert, delete on public.lord_community_bookmarks to authenticated;
grant select, insert on public.lord_community_reports to authenticated;

create or replace function public.lord_community_vote_count() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update lord_community_creations set helpful_count = helpful_count + 1 where id = new.creation_id;
  else update lord_community_creations set helpful_count = greatest(0, helpful_count - 1) where id = old.creation_id;
  end if;
  return coalesce(new, old);
end $$;
create trigger lord_community_vote_count_trigger after insert or delete on public.lord_community_votes for each row execute function public.lord_community_vote_count();
