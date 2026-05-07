-- URL ingestion metadata for public webpages, PDFs, and YouTube links.

alter table files
  add column if not exists source_type text not null default 'file'
    check (source_type in ('file', 'webpage', 'pdf', 'youtube')),
  add column if not exists source_url text,
  add column if not exists extraction_status text not null default 'stored'
    check (extraction_status in ('stored', 'extracted', 'no_text', 'failed')),
  add column if not exists extraction_error text;

create unique index if not exists files_source_url_unique
  on files (source_url)
  where source_url is not null;

create index if not exists files_source_type on files (source_type);
create index if not exists files_extraction_status on files (extraction_status);
