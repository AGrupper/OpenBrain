-- Semantic vector search for chat retrieval. Mirrors search_files column shape so the
-- Worker can blend FTS and vector results uniformly via Reciprocal Rank Fusion.
--
-- NOTE: the IVFFlat index (embeddings_vector) was dropped in production because it had
-- lists=100 with only ~9 rows, causing probes=1 to hit empty lists and return nothing.
-- Postgres falls back to a sequential scan without the index, which is correct and fast
-- at this scale. Recreate with lists=sqrt(row_count) once the table has 1000+ rows.
--   drop index if exists embeddings_vector;
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
  order by e.embedding <=> query_embedding asc
  limit result_limit;
$$;
