-- Enable pgvector extension
create extension if not exists vector;

-- Files table: tracks every file in the vault
create table if not exists files (
  id          uuid primary key default gen_random_uuid(),
  path        text not null unique,
  size        bigint not null default 0,
  sha256      text not null,
  mime        text not null default 'application/octet-stream',
  folder      text,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  needs_embedding   boolean not null default true,
  needs_linking     boolean not null default true,
  needs_tagging     boolean not null default true,
  text_content      text
);

create index if not exists files_needs_embedding on files (needs_embedding) where needs_embedding = true;
create index if not exists files_needs_linking on files (needs_linking) where needs_linking = true;
create index if not exists files_needs_tagging on files (needs_tagging) where needs_tagging = true;
create index if not exists files_folder on files (folder);

-- Full-text search index on path + text_content
create index if not exists files_fts on files using gin(
  to_tsvector('english', coalesce(path, '') || ' ' || coalesce(text_content, ''))
);

-- Embeddings table: one row per file, 1024-dim Voyage vector
create table if not exists embeddings (
  file_id     uuid primary key references files(id) on delete cascade,
  embedding   vector(1024) not null,
  text_preview text not null default '',
  embedded_at timestamptz not null default now()
);

create index if not exists embeddings_vector on embeddings using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Tags table: many tags per file
create table if not exists file_tags (
  id       uuid primary key default gen_random_uuid(),
  file_id  uuid not null references files(id) on delete cascade,
  tag      text not null,
  unique(file_id, tag)
);

create index if not exists file_tags_file on file_tags (file_id);
create index if not exists file_tags_tag on file_tags (tag);

-- Links table: approved connections between files
create table if not exists links (
  id          uuid primary key default gen_random_uuid(),
  file_a_id   uuid not null references files(id) on delete cascade,
  file_b_id   uuid not null references files(id) on delete cascade,
  confidence  float not null,
  reason      text not null,
  status      text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'auto_approved')),
  telegram_message_id bigint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(file_a_id, file_b_id)
);

create index if not exists links_status on links (status);
create index if not exists links_file_a on links (file_a_id);
create index if not exists links_file_b on links (file_b_id);

-- Corrections table: logs manual overrides for Friday's in-context learning
create table if not exists corrections (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid not null references files(id) on delete cascade,
  field       text not null check (field in ('folder', 'tags')),
  old_value   text,
  new_value   text,
  created_at  timestamptz not null default now()
);

create index if not exists corrections_recent on corrections (created_at desc);

-- Trust threshold tracking: counts of consecutive auto-approved obvious links
create table if not exists trust_metrics (
  id                        integer primary key default 1,
  consecutive_obvious_approvals integer not null default 0,
  obvious_links_silent      boolean not null default false,
  updated_at                timestamptz not null default now()
);

insert into trust_metrics (id) values (1) on conflict do nothing;
