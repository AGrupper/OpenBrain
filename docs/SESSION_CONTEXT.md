# OpenBrain Session Context

This is the living handoff file for new work sessions. Update it at the end of each meaningful
session so the next session can start from repo truth instead of chat history.

## Current Checkpoint

- Branch: `master`
- Remote: `origin/master`
- Latest implementation commit before docs wrap-up: `23def5d` (`Add graph node detail panel`)
- Before the 2026-05-05 publish step, the local branch was 6 commits ahead of `origin/master`.
  Always re-check current sync state with `git status -sb` at session start.
- Tracked working tree was clean at the 2026-05-05 wrap-up check.
- Current implementation direction is tracked in `docs/MASTER_PLAN.md`.
- The 2026-05-05 follow-up suppresses no-op Architect folder/tag review suggestions and adds
  regression coverage.
- The later 2026-05-05 implementation adds the approved draft-visible Architect Wiki foundation:
  migration `006_wiki.sql`, chunk citations, wiki nodes/pages/revisions/edges, Worker `/wiki`
  routes, automatic wiki draft generation, and Graph UI support for generated wiki pages.
- Manual draft-visible wiki smoke found one local regeneration gap: Markdown saves correctly set
  `files.needs_wiki=true`, but the local `ctx.waitUntil` rebuild was not completing reliably.
  Desktop Markdown saves now call `PATCH /files/:id?run_wiki=true`, and the Worker awaits just the
  wiki rebuild for that explicit save path while keeping linker/tagger work in the background.
- After checkpoint commit `d2821df`, Graph cleanup changed the default Graph surface to show only
  conceptual wiki nodes (`topic`, `claim`, `synthesis`). Raw files and `source` wiki nodes are
  hidden from the default graph and remain accessible through source/citation detail.
- Milestone 2 is now complete based on the user's 2026-05-05 manual screenshots: approving the
  fresh deterministic PARA folder and tag suggestions placed `openbrain-smoke-related-fresh.md`
  under `Resources/smoke/related` with `architect-smoke` and `related` tags visible in the reader.
- Starting commit for this session: `c37ab89` (`Add OpenBrain session context handoff`)
- Pushed implementation commit: `4cc6d30` (`Fix vault filename search and stale reader state`)
- Pushed handoff commit before browser smoke confirmation: `a55f089`
  (`Update OpenBrain session context after search fix`)
- Final handoff update records the browser smoke confirmation.
- Current session fixed deterministic Architect smoke execution from `services/architect-agent`,
  clarified local Worker env file usage, verified the review API loop against the running local
  Worker, tightened Review Inbox reload behavior after decisions, and added the first Markdown
  edit/save workspace slice.
- The user confirmed the Markdown edit/save/search smoke works in the running app.
- Overnight follow-up committed the Markdown workspace checkpoint locally as `f907a22`
  (`Complete Markdown note workspace loop`) and committed the first safe Graph-First Architect Wiki
  slice locally as `23def5d` (`Add graph node detail panel`). No migrations were added; graph node
  details use existing raw files and approved links.
- Current URL ingestion slice adds migration `007_url_ingestion.sql`, Worker `POST /files/url`,
  shared URL source metadata types, and desktop URL import UI. The user applied the migration in
  Supabase on 2026-05-08, reloaded PostgREST schema, and live API smoke passed against the local
  Worker.

## Completed

- The repo was reorganized around the Architect vault direction:
  - Product docs live in `docs/PRD.md`.
  - Architecture docs live in `docs/TECHNICAL_PLAN.md`.
  - Repo map lives in `docs/PROJECT_STRUCTURE.md`.
- Folder sync was removed from v1. Manual local file import is the core ingestion path.
- The dedicated OpenBrain AI job service is now `services/architect-agent`.
- The Worker has routes for files, links, search, corrections, Architect jobs, suggestions, and chat.
- The desktop app has List, Graph, Review, Architect chat, Settings, and manual import surfaces.
- Rust Clippy was fixed in `apps/desktop/src-tauri/src/lib.rs` by changing the inbox-path helper
  to accept `&Path` instead of `&PathBuf`.
- Local Worker env files are ignored:
  - `services/worker/.dev.vars`
  - `services/worker/.dev.var`
- Vault search now merges full-text results with direct filename/path matches, so queries like
  `readme.md` can find files even when the filename is not present in file content.
- The desktop reader now avoids rendering failed download responses as Markdown preview text.
- The desktop app now reconciles the selected reader file after vault reloads, so deleted files do
  not stay selected after the list refreshes.
- Browser smoke confirmed the latest search and reader fixes work in the running app.
- The Architect now has deterministic smoke mode for local review-loop testing without provider API
  calls.
- Supabase migration `004_folders.sql` adds persistent folder records.
- The Worker now exposes `/folders` and `/files/text`.
- The desktop List view is now an expandable persistent folder explorer.
- The desktop app can create folders and blank Markdown notes directly in the app.
- Manual file import now targets the selected folder in the explorer instead of always `Inbox`.
- `docs/MASTER_PLAN.md` now defines the durable PARA Vault + Graph-First Architect Wiki
  implementation roadmap.
- PARA roots are first-class raw-vault roots: `Projects`, `Areas`, `Resources`, and `Archive`.
- The folders API returns protected synthetic PARA roots even before matching database rows exist.
- The desktop List view always shows the PARA roots, protects root deletion, and defaults new
  folders, notes, and imports to `Resources` when no folder is selected.
- The desktop List view now uses inline folder/note creation controls instead of prompt dialogs for
  creation.
- The Architect tagger now asks for PARA folder placements, normalizes non-PARA suggestions under
  `Resources`, and uses PARA-specific Review Inbox wording.
- Docs are now flat under `docs`; the previous `docs/product`, `docs/architecture`, `docs/project`,
  and `docs/setup` subfolders were removed.
- Desktop frontend source is now organized as `src/app`, `src/features/*`, and `src/shared/*`
  instead of broad `src/views`, `src/components`, `src/lib`, and `src/styles` buckets.
- `services/architect-agent` can now run `npm run smoke:run` under `tsx` after marking
  `@openbrain/shared` as an ES module package and using explicit `.ts` imports for shared source
  files.
- `services/worker/.env.example` and `docs/CLOUD_SETUP.md` now clarify that local Worker dev uses
  `services/worker/.dev.vars`; `services/worker/.env` alone is not read by `wrangler dev`.
- A disposable pending tag suggestion for `smoke/scratch-to-delete.md` was approved through the
  local Worker API, updating its tags to `architect-smoke`.
- The desktop Review Inbox now reloads vault state after link or Architect suggestion decisions so
  approved folder/tag/link changes are reflected without relying on a manual app reload.
- Browser screenshots confirmed the local app can open a vault file in the reader, render smoke
  vault nodes in Graph, and create `Resources/SmokeManual/manual-smoke.md` from inline PARA controls.
- Markdown notes can now be edited in the reader and saved back through the Worker.
- Markdown saves rewrite the R2 object, recompute `sha256` and `size`, update `text_content`, set
  reprocessing flags, and create a pending Architect job.
- The reader now has `Edit`, `Save`, and `Cancel` controls for Markdown files, save-error display,
  and a discard prompt for in-list navigation while a note has unsaved changes.
- Milestone 3 is complete after manual smoke confirmed Markdown create/edit/save/search behavior.
- Milestone 1 is complete: approved links are now inspectable in both reader-facing connected-file
  context and the Graph view.
- Graph links now use higher-contrast rendering, and clicking a graph node opens a detail panel
  with path, PARA folder, tags, summary when present, connected files, reasons, confidence, and an
  explicit `Open in reader` action.
- The shared `VaultFile` type now includes the existing optional `summary` field so the desktop can
  display summaries already returned by the Worker.
- The Worker scheduled tagger and standalone Architect agent tagger now skip no-op folder/tag
  suggestions, including the stale case where a Review Inbox card recommends the file's existing
  PARA folder.
- The taggers still clear `needs_tagging` after no-op organization results so already-organized
  files do not keep re-entering the suggestion loop.
- Milestone 2 is complete: the running app manually confirmed a fresh deterministic Review Inbox
  folder placement and tag suggestion shape the PARA vault only after approval.
- Migration `006_wiki.sql` defines the draft-visible Architect Wiki storage layer:
  `source_chunks`, `wiki_nodes`, `wiki_pages`, `wiki_revisions`, `wiki_edges`, `wiki_citations`,
  and `files.needs_wiki`.
- Worker `/wiki/graph` returns visible draft/published wiki nodes and edges.
- Worker `/wiki/nodes/:id` returns node detail, current page, latest revision chunk citations,
  backlinks, outgoing edges, and revision history.
- The Worker wiki builder splits text sources into overlapping chunks, generates deterministic or
  provider-backed draft wiki nodes, stores chunk citations, archives stale source-specific draft
  nodes/edges on regeneration, and only patches raw files by clearing `needs_wiki`.
- File upload, Markdown note creation, Markdown saves, real path changes, and scheduled Worker runs
  now queue or run wiki generation.
- Desktop Markdown saves now request an immediate wiki rebuild so local edits produce fresh wiki
  revisions without waiting for the scheduled Worker sweep.
- The initial desktop Graph wiki slice merged raw file nodes with draft wiki nodes so provenance
  could be smoked quickly, and opened generated wiki pages with chunk citations, backlinks,
  outgoing edges, and history.
- The desktop Graph cleanup now defaults to the Architect understanding layer only: visible nodes
  are `topic`, `claim`, and `synthesis`; raw files and `source` wiki nodes are kept out of the
  default graph.
- Milestone 5 has started with a conservative processing-state UI slice: the List view now surfaces
  existing `needs_embedding`, `needs_linking`, `needs_tagging`, and `needs_wiki` flags without new
  schema or route changes.
- The follow-up Milestone 5 slice now keeps empty/no-text files out of wiki-pending state and shows
  original storage separately from text extraction result in the List processing panel.
- URL ingestion v1 is implemented for public webpages, PDFs, and YouTube links:
  - `007_url_ingestion.sql` adds URL source metadata and extraction status fields to `files`.
  - `POST /files/url` validates public `http(s)` URLs, blocks local/private hosts and redirects,
    imports the URL as a Markdown source note, stores source metadata, and queues Architect work.
  - Webpage imports extract readable HTML text and can generate wiki drafts.
  - PDF and YouTube imports are preserved as source notes with `extraction_status=no_text` and no
    fake wiki-pending work.
  - URL imports match existing folder tokens before falling back to `Resources/Web`.
  - Desktop has an import-bar URL field, shows source URL/extraction state in List, and opens source
    URLs in the system browser.
- Notion access is intentionally deferred to a separate authenticated connector/integration slice.

## Verified

Last verified on 2026-05-05 after the draft-visible wiki implementation:

- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run format:check`
- `npm.cmd -w apps/desktop run build` passed outside the sandbox after the known Vite/esbuild
  `spawn EPERM`; it emitted the existing large chunk warning.
- `npm.cmd test` passed outside the sandbox after the known Vitest `spawn EPERM` with 101 tests.
- Focused wiki regression tests passed outside the sandbox after the known Vitest `spawn EPERM`:
  `npm.cmd test -- services/worker/src/jobs/wiki.test.ts services/worker/src/routes/wiki.test.ts services/worker/src/routes/files.test.ts`
  with 48 tests.
- Manual smoke confirmed draft wiki nodes appear in Graph, wiki node details show draft status,
  generated Markdown, chunk citations, backlinks/outgoing edges, and revision history. A direct
  builder run regenerated `Resources/openbrain-smoke-related-fresh.md` and cleared
  `needs_wiki=false` after the local save-trigger gap was diagnosed.
- After Graph cleanup, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run format:check`,
  `npm.cmd test`, and `npm.cmd -w apps/desktop run build` passed. API smoke confirmed one local
  Worker listener, `Revision 3`, citations through char 185, three visible conceptual wiki nodes,
  and one hidden source node in storage.
- After the Milestone 5 processing-state UI slice, `npm.cmd run typecheck`, `npm.cmd run lint`, and
  `npm.cmd run format:check` passed before full final verification.
- On 2026-05-07 after the no-text processing fix and extraction-status UI update:
  `npm.cmd test -- services/worker/src/routes/files.test.ts`, `npm.cmd run typecheck`,
  `npm.cmd run lint`, `npm.cmd run format:check`, `npm.cmd test`, and
  `npm.cmd -w apps/desktop run build` passed. Vitest and desktop build needed outside-sandbox
  reruns after the known Windows `spawn EPERM`.
- During the 2026-05-07 URL ingestion slice, `npm.cmd run typecheck`, `npm.cmd run lint`, and
  `npm.cmd run format:check` passed. Focused Vitest for `services/worker/src/routes/files.test.ts`
  hit the known sandbox `spawn EPERM`, and the outside-sandbox rerun was blocked by the platform
  usage limit, so test execution still needs a later rerun.
- On 2026-05-08 after applying `007_url_ingestion.sql`, live URL ingestion smoke passed:
  - `GET /files?limit=1` reached the local Worker.
  - Webpage import from `example.com` created a source note with `source_type=webpage`,
    `extraction_status=extracted`, `needs_wiki=true`, then processing cleared `needs_wiki=false`.
  - PDF import created a `source_type=pdf`, `extraction_status=no_text`, `needs_wiki=false` source.
  - YouTube import created a `source_type=youtube`, `extraction_status=no_text`,
    `needs_wiki=false` source.
  - Private URL import returned 400 and duplicate URL import returned 409.
  - Desktop-visible graph filtering still excludes `source` nodes; the imported webpage had three
    visible wiki concepts and node detail returned citation/history data.
- The follow-up YouTube ingestion slice attempts public caption-track extraction through YouTube's
  public timed-text metadata and stores transcript text when captions are exposed. A live Rick
  Astley URL smoke still returned `no_text`, so the fallback path is confirmed; a caption-positive
  live smoke is still useful when a known public-caption URL is available.

Earlier verified on 2026-05-05 after the no-op Architect suggestion fix:

- Targeted tagger regression tests passed with 13 focused tests:
  `npm.cmd test -- services/architect-agent/tests/tagger.test.ts services/worker/src/jobs/tagger.test.ts`.
  The sandboxed run hit `spawn EPERM`, so the passing run was outside the sandbox.
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run format:check`

Earlier verified on 2026-05-04 after the graph node detail panel slice:

- `npm.cmd test` passed with 92 tests when run outside the sandbox after sandboxed Vitest hit
  `spawn EPERM`.
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run format:check`
- `npm.cmd -w apps/desktop run build` passed outside the sandbox after sandboxed esbuild hit
  `spawn EPERM`.
- Manual browser smoke was not rerun for the graph detail panel in this checkpoint.
- Earlier on 2026-05-04 after the Markdown edit/save manual smoke:
- The user confirmed Markdown edit, save, reload/reselect, and search smoke worked in the running
  app.
- Earlier on 2026-05-04 after the Architect smoke/env fix:
- `npm.cmd -w services/architect-agent run smoke:run` passed against the local Worker after loading
  the token from `services/worker/.dev.vars` and overriding `OPENBRAIN_API_URL` to
  `http://127.0.0.1:8787`; it found no remaining files needing linking/tagging.
- Local Worker API smoke:
  - `GET /files?limit=20` returned 9 files.
  - `GET /architect/suggestions?status=pending` returned 14 pending suggestions before the
    disposable approval.
  - `PATCH /architect/suggestions/138bf912-8f7c-41cd-9328-750319dd8ef6` approved the disposable tag
    suggestion.
  - `GET /files/2e447f85-2df3-41d4-9654-5b0e6ee11e39` showed
    `smoke/scratch-to-delete.md` with `architect-smoke`.
  - `GET /links/for-file/2e447f85-2df3-41d4-9654-5b0e6ee11e39` returned one approved reader-facing
    link.
- Earlier on 2026-05-04 after the master-plan/PARA slice:
- After replacing creation prompts with inline controls, `npm.cmd run typecheck`, `npm.cmd run lint`,
  and `npm.cmd -w apps/desktop run build` passed again.
- After flattening docs and reorganizing desktop source folders, `npm.cmd run typecheck`,
  `npm.cmd run lint`, `npm.cmd run format:check`, `npm.cmd -w apps/desktop run build`, and
  `npm.cmd test` passed. The build/test commands needed to run outside the sandbox because Vite and
  Vitest hit the known `spawn EPERM` restriction inside the sandbox.
- `cargo fmt --all -- --check`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test --all-features`

Earlier verified on 2026-05-01:

- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`
- `npm.cmd test` passed with 67 tests.
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run format:check`
- `services/worker`: `npm.cmd run typecheck`
- `services/worker`: `npm.cmd test`
- `apps/desktop`: `npm.cmd run typecheck`
- `apps/desktop`: `npm.cmd run build`
- `apps/desktop/src-tauri`: `cargo test`

Manual smoke verified:

- Desktop app reaches the local Worker.
- Desktop and Worker auth work when `VITE_AUTH_TOKEN` and `OPENBRAIN_AUTH_TOKEN` match locally.
- Manual Markdown import works.
- Imported files appear in List view.
- Imported files open in the reader.
- Content search for text inside a Markdown file worked in the desktop app before the filename
  search fix.
- Filename/path search works in the desktop app after the fix.
- Rename worked in the desktop app before this fix.
- Delete removed the file from the list; the stale selected-reader state is fixed after the latest
  browser smoke.
- Review Inbox loads and shows the correct empty state when no pending suggestions exist.
- Graph loads without crashing with the current one-file vault.
- Settings masks the local auth token.
- Deterministic Architect smoke created reviewable link, tag, and folder suggestions after
  `003_architect.sql` was applied.
- Deterministic Architect smoke runner now starts successfully from `services/architect-agent`.
- The local Worker currently has two approved links, including the disposable smoke related pair;
  approved links are visible through the graph data endpoint and the reader `links/for-file` API.
- Approving a disposable Review Inbox tag suggestion through the API updates the target file
  metadata.
- Persistent folder explorer loads after `004_folders.sql` is applied.
- Creating a folder and blank note directly in the app works and persists.
- Local screenshots on 2026-05-04 confirmed `Resources/SmokeManual/manual-smoke.md` creation in the
  running app.
- Local screenshots on 2026-05-05 confirmed approving the fresh deterministic folder/tag
  suggestions moved `openbrain-smoke-related-fresh.md` into `Resources/smoke/related` and displayed
  the approved `architect-smoke` / `related` tags.

## Local Setup Notes

- Do not commit local secrets.
- Desktop local env lives in `apps/desktop/.env.local`.
- Worker local env lives in `services/worker/.dev.vars`.
- `services/worker/.env` is not read by `wrangler dev` by default. If values were placed there,
  copy them into `.dev.vars` or explicitly load them before starting the Worker.
- The desktop token `VITE_AUTH_TOKEN` must match the Worker token `OPENBRAIN_AUTH_TOKEN`.
- Wrangler uses `.dev.vars` plural, not `.dev.var`.
- `SUPABASE_SERVICE_KEY` belongs only in Worker/local server env, never in the desktop env.
- After adding database migrations manually in Supabase SQL Editor, use `notify pgrst, 'reload schema';`
  or restart the local Worker before testing new routes.

## Next Targets

Continue from `docs/MASTER_PLAN.md`.

Immediate targets:

1. Finish Graph-First Architect Wiki cleanup smoke:
   - Stop duplicate local Worker processes if more than one `workerd` is listening on
     `127.0.0.1:8787`.
   - Restart Worker and desktop cleanly.
   - Verify Graph defaults to wiki concepts only: no raw file nodes and no `source` wiki nodes.
   - Verify clicking a visible wiki node shows generated page content, source file, chunk citations,
     backlinks, outgoing edges, and history.
2. Review or clean remaining pending suggestions:
   - Reject the stale no-op `manual-smoke.md -> Resources/SmokeManual` folder card if it remains
     visible.
   - Do not approve unrelated deterministic smoke placements for real personal files unless the
     suggested folder is actually correct.
   - Do not delete disposable smoke notes/folders unless the user explicitly approves cleanup.
3. Continue Milestone 5 broad ingestion:
   - Next implementation slice after URL smoke: PDF text extraction, or Notion connector planning if
     the user prioritizes Notion.
   - Leave the disposable URL smoke files in the vault unless the user explicitly approves cleanup.
4. After publish, verify `git status -sb` before starting new work.

## Guardrails

- Do not touch secrets, auth logic, database migrations, payments, or deployment config without an
  explicit warning and approval.
- Do not reintroduce folder sync into v1 without a product decision.
- Do not allow The Architect to silently move, delete, rename, tag, summarize, or link files.
- Do not add folder rename/move until recursive R2 object movement and DB path updates are handled
  as one deliberate feature.
- Keep changes simple and scoped. Prefer proving the current product loop before adding new
  architecture.
