-- Semantic nearest-neighbor search using pgvector
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
  order by e.embedding <=> target_emb.embedding
  limit result_limit;
$$;

-- Hybrid full-text + keyword search
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
  where
    to_tsvector('english', coalesce(f.path, '') || ' ' || coalesce(f.text_content, ''))
    @@ websearch_to_tsquery('english', query_text)
  order by rank desc
  limit result_limit;
$$;

-- Increment trust counter; flip to silent mode at threshold 50
create or replace function increment_trust()
returns void
language plpgsql
as $$
begin
  update trust_metrics
  set
    consecutive_obvious_approvals = consecutive_obvious_approvals + 1,
    obvious_links_silent = (consecutive_obvious_approvals + 1) >= 50,
    updated_at = now()
  where id = 1;
end;
$$;
