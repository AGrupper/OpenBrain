-- The Architect: OpenBrain-owned AI jobs, reviewable suggestions, and vault-grounded chat.

alter table files
  add column if not exists summary text;

create table if not exists architect_jobs (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid not null references files(id) on delete cascade,
  status      text not null default 'pending'
    check (status in ('pending', 'processing', 'suggestions_created', 'failed')),
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists architect_jobs_status on architect_jobs (status, created_at desc);
create index if not exists architect_jobs_file on architect_jobs (file_id);

create table if not exists architect_suggestions (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid references files(id) on delete cascade,
  type        text not null
    check (type in ('summary', 'tags', 'folder', 'link', 'action', 'cleanup')),
  title       text not null,
  reason      text not null,
  payload     jsonb not null default '{}'::jsonb,
  confidence  float,
  status      text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists architect_suggestions_status
  on architect_suggestions (status, created_at desc);
create index if not exists architect_suggestions_file on architect_suggestions (file_id);
create index if not exists architect_suggestions_payload on architect_suggestions using gin (payload);

create table if not exists architect_chat_sessions (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists architect_chat_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references architect_chat_sessions(id) on delete cascade,
  role        text not null check (role in ('user', 'architect')),
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists architect_chat_messages_session
  on architect_chat_messages (session_id, created_at);

create table if not exists architect_chat_message_sources (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references architect_chat_messages(id) on delete cascade,
  file_id     uuid not null references files(id) on delete cascade,
  path        text not null,
  snippet     text not null default '',
  score       float,
  created_at  timestamptz not null default now()
);

create index if not exists architect_chat_sources_message
  on architect_chat_message_sources (message_id);
create index if not exists architect_chat_sources_file
  on architect_chat_message_sources (file_id);
