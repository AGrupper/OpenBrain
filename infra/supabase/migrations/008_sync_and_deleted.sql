-- Soft delete and one-way external sync metadata.

alter table files
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_reason text;

alter table files drop constraint if exists files_source_type_check;
alter table files
  add constraint files_source_type_check
  check (source_type in ('file', 'webpage', 'pdf', 'youtube', 'notion', 'apple_notes'));

create index if not exists files_not_deleted on files (updated_at desc) where deleted_at is null;
create index if not exists files_deleted_at on files (deleted_at desc) where deleted_at is not null;

create table if not exists sync_sources (
  id             uuid primary key default gen_random_uuid(),
  type           text not null check (type in ('notion', 'apple_notes')),
  name           text not null,
  config         jsonb not null default '{}'::jsonb,
  status         text not null default 'active' check (status in ('active', 'paused', 'error')),
  last_synced_at timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique(type, name)
);

create index if not exists sync_sources_type on sync_sources (type);
create index if not exists sync_sources_status on sync_sources (status);

create table if not exists sync_items (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid not null references sync_sources(id) on delete cascade,
  external_id    text not null,
  file_id        uuid references files(id) on delete set null,
  external_url   text,
  content_hash   text,
  status         text not null default 'synced' check (status in ('synced', 'skipped', 'failed')),
  metadata       jsonb not null default '{}'::jsonb,
  last_seen_at   timestamptz not null default now(),
  last_synced_at timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique(source_id, external_id)
);

create index if not exists sync_items_source on sync_items (source_id);
create index if not exists sync_items_file on sync_items (file_id);
create index if not exists sync_items_external on sync_items (external_id);

create or replace function neighbors(target_file_id uuid, result_limit int default 10)
returns table (
  file_id     uuid,
  path        text,
  confidence  float
)
language sql stable
as $$
  select
    f.id as file_id,
    f.path,
    1 - (e.embedding <=> target_emb.embedding) as confidence
  from embeddings e
  join files f on f.id = e.file_id,
  (select embedding from embeddings where file_id = target_file_id) target_emb
  where e.file_id <> target_file_id
    and f.deleted_at is null
  order by e.embedding <=> target_emb.embedding
  limit result_limit;
$$;

create or replace function search_files(query_text text, result_limit int default 5)
returns table (
  id          uuid,
  path        text,
  size        bigint,
  sha256      text,
  mime        text,
  updated_at  timestamptz,
  rank        float,
  snippet     text
)
language sql stable
as $$
  select
    f.id,
    f.path,
    f.size,
    f.sha256,
    f.mime,
    f.updated_at,
    ts_rank_cd(
      to_tsvector('english', coalesce(f.path, '') || ' ' || coalesce(f.text_content, '')),
      websearch_to_tsquery('english', query_text)
    ) as rank,
    ts_headline(
      'english',
      coalesce(f.text_content, f.path),
      websearch_to_tsquery('english', query_text),
      'MaxWords=30, MinWords=10, StartSel=**,StopSel=**'
    ) as snippet
  from files f
  where f.deleted_at is null
    and to_tsvector('english', coalesce(f.path, '') || ' ' || coalesce(f.text_content, ''))
    @@ websearch_to_tsquery('english', query_text)
  order by rank desc
  limit result_limit;
$$;

create or replace function search_files_by_embedding(
  query_embedding vector(1024),
  result_limit int default 5
)
returns table (
  id          uuid,
  path        text,
  size        bigint,
  sha256      text,
  mime        text,
  updated_at  timestamptz,
  rank        float,
  snippet     text
)
language sql stable
as $$
  select
    f.id,
    f.path,
    f.size,
    f.sha256,
    f.mime,
    f.updated_at,
    (1 - (e.embedding <=> query_embedding))::float as rank,
    coalesce(left(f.text_content, 300), f.path) as snippet
  from embeddings e
  join files f on f.id = e.file_id
  where f.deleted_at is null
  order by e.embedding <=> query_embedding asc
  limit result_limit;
$$;
