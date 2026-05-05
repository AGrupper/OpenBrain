# OpenBrain Session Context

This is the living handoff file for new work sessions. Update it at the end of each meaningful
session so the next session can start from repo truth instead of chat history.

## Current Checkpoint

- Branch: `master`
- Remote: `origin/master`
- Latest implementation commit before docs wrap-up: `23def5d` (`Add graph node detail panel`)
- Local branch is intentionally not pushed and is currently 6 commits ahead of `origin/master`.
- Tracked working tree was clean at the 2026-05-05 wrap-up check.
- Current implementation direction is tracked in `docs/MASTER_PLAN.md`.
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

## Verified

Last verified on 2026-05-04 after the graph node detail panel slice:

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

1. Finish Milestone 2 confidence:
   - Manually smoke the Review Inbox loop in the running app if fresh pending deterministic PARA
     suggestions are available.
   - Do not delete disposable smoke notes/folders unless the user explicitly approves cleanup.
2. Continue Graph-First Architect Wiki:
   - The next meaningful step is schema-backed generated wiki pages/nodes, citations, backlinks,
     and update history.
   - Stop for explicit approval before adding the required Supabase migration.
3. Decide whether to push the 5 local commits on `master` to `origin/master`.

## Guardrails

- Do not touch secrets, auth logic, database migrations, payments, or deployment config without an
  explicit warning and approval.
- Do not reintroduce folder sync into v1 without a product decision.
- Do not allow The Architect to silently move, delete, rename, tag, summarize, or link files.
- Do not add folder rename/move until recursive R2 object movement and DB path updates are handled
  as one deliberate feature.
- Keep changes simple and scoped. Prefer proving the current product loop before adding new
  architecture.
