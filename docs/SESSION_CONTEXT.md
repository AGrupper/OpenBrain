# OpenBrain Session Context

This is the living handoff file for new work sessions. Update it at the end of each meaningful
session so the next session can start from repo truth instead of chat history.

## Current Checkpoint

- Branch: `master`
- Remote: `origin/master`
- Current implementation direction is tracked in `docs/MASTER_PLAN.md`.
- Starting commit for this session: `c37ab89` (`Add OpenBrain session context handoff`)
- Pushed implementation commit: `4cc6d30` (`Fix vault filename search and stale reader state`)
- Pushed handoff commit before browser smoke confirmation: `a55f089`
  (`Update OpenBrain session context after search fix`)
- Final handoff update records the browser smoke confirmation.
- Current session adds deterministic Architect smoke mode and a persistent folder explorer.

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

## Verified

Last verified on 2026-05-04 after the master-plan/PARA slice:

- `npm.cmd test` passed with 89 tests when run outside the sandbox after sandboxed Vitest hit
  `spawn EPERM`.
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run format:check`
- `npm.cmd -w apps/desktop run build` passed outside the sandbox after sandboxed esbuild hit
  `spawn EPERM`.
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
- Persistent folder explorer loads after `004_folders.sql` is applied.
- Creating a folder and blank note directly in the app works and persists.

## Local Setup Notes

- Do not commit local secrets.
- Desktop local env lives in `apps/desktop/.env.local`.
- Worker local env lives in `services/worker/.dev.vars`.
- The desktop token `VITE_AUTH_TOKEN` must match the Worker token `OPENBRAIN_AUTH_TOKEN`.
- Wrangler uses `.dev.vars` plural, not `.dev.var`.
- `SUPABASE_SERVICE_KEY` belongs only in Worker/local server env, never in the desktop env.
- After adding database migrations manually in Supabase SQL Editor, use `notify pgrst, 'reload schema';`
  or restart the local Worker before testing new routes.

## Next Targets

Continue from `docs/MASTER_PLAN.md`.

Immediate targets:

1. Start Milestone 1:
   - Approve a deterministic smoke link suggestion.
   - Confirm approved links appear in the reader and Graph view.
2. Continue Milestone 2:
   - Manually smoke inline folder/note creation in the running desktop app.
   - Keep "All files" available as a neutral view while PARA roots remain first-class.
3. Continue repo structure cleanup if useful:
   - Reorganize Worker source by feature after this desktop/docs slice is verified.

## Guardrails

- Do not touch secrets, auth logic, database migrations, payments, or deployment config without an
  explicit warning and approval.
- Do not reintroduce folder sync into v1 without a product decision.
- Do not allow The Architect to silently move, delete, rename, tag, summarize, or link files.
- Do not add folder rename/move until recursive R2 object movement and DB path updates are handled
  as one deliberate feature.
- Keep changes simple and scoped. Prefer proving the current product loop before adding new
  architecture.
