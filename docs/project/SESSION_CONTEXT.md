# OpenBrain Session Context

This is the living handoff file for new work sessions. Update it at the end of each meaningful
session so the next session can start from repo truth instead of chat history.

## Current Checkpoint

- Branch: `master`
- Remote: `origin/master`
- Latest pushed commit: `98055ea` (`Ignore local Wrangler env files`)
- Previous commit: `91be88a` (`Fix Tauri import Clippy warning`)
- Working tree at last handoff: clean

## Completed

- The repo was reorganized around the Architect vault direction:
  - Product docs live in `docs/product/PRD.md`.
  - Architecture docs live in `docs/architecture/TECHNICAL_PLAN.md`.
  - Repo map lives in `docs/project/PROJECT_STRUCTURE.md`.
- Folder sync was removed from v1. Manual local file import is the core ingestion path.
- The dedicated OpenBrain AI job service is now `services/architect-agent`.
- The Worker has routes for files, links, search, corrections, Architect jobs, suggestions, and chat.
- The desktop app has List, Graph, Review, Architect chat, Settings, and manual import surfaces.
- Rust Clippy was fixed in `apps/desktop/src-tauri/src/lib.rs` by changing the inbox-path helper
  to accept `&Path` instead of `&PathBuf`.
- Local Worker env files are ignored:
  - `services/worker/.dev.vars`
  - `services/worker/.dev.var`

## Verified

Last verified on 2026-05-01:

- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`
- `npm.cmd test` passed with 65 tests.
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run format:check`

Manual smoke verified:

- Desktop app reaches the local Worker.
- Desktop and Worker auth work when `VITE_AUTH_TOKEN` and `OPENBRAIN_AUTH_TOKEN` match locally.
- Manual Markdown import works.
- Imported files appear in List view.
- Imported files open in the reader.

## Local Setup Notes

- Do not commit local secrets.
- Desktop local env lives in `apps/desktop/.env.local`.
- Worker local env lives in `services/worker/.dev.vars`.
- The desktop token `VITE_AUTH_TOKEN` must match the Worker token `OPENBRAIN_AUTH_TOKEN`.
- Wrangler uses `.dev.vars` plural, not `.dev.var`.
- `SUPABASE_SERVICE_KEY` belongs only in Worker/local server env, never in the desktop env.

## Next Targets

Start with the working import/list/reader loop and move outward:

1. Verify Search:
   - Search for text inside an imported Markdown file.
   - Confirm the file appears in search results.
   - If it fails, debug `services/worker/src/routes/search.ts` and `apps/desktop/src/views/SearchBar.tsx`.
2. Verify Rename and Delete persistence:
   - Rename an imported file from the desktop app.
   - Refresh/reopen and confirm the renamed path persists.
   - Delete a scratch file and confirm it stays gone after refresh.
   - If it fails, debug `services/worker/src/routes/files.ts` and `apps/desktop/src/views/ListView.tsx`.
3. Move to Review Inbox and Architect suggestions:
   - Run `services/architect-agent` jobs against imported files.
   - Confirm pending suggestions appear in Review Inbox.
   - Confirm approving/rejecting suggestions updates Worker/Supabase state correctly.

## Guardrails

- Do not touch secrets, auth logic, database migrations, payments, or deployment config without an
  explicit warning and approval.
- Do not reintroduce folder sync into v1 without a product decision.
- Do not allow The Architect to silently move, delete, rename, tag, summarize, or link files.
- Keep changes simple and scoped. Prefer proving the current product loop before adding new
  architecture.
