-- Persistent folder records for the cloud vault explorer.

create table if not exists folders (
  path        text primary key,
  name        text not null,
  parent_path text references folders(path) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (path <> ''),
  check (name <> '')
);

create index if not exists folders_parent on folders (parent_path, name);
