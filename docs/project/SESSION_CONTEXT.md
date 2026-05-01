# OpenBrain Session Context

This is the living handoff file for new work sessions. Update it at the end of each meaningful
session so the next session can start from repo truth instead of chat history.

## Current Checkpoint

- Branch: `master`
- Remote: `origin/master`
- Starting commit for this session: `c37ab89` (`Add OpenBrain session context handoff`)
- Handoff commit for this session: `Fix vault filename search and stale reader state`
- Working tree at verification: intentional changes only

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
- Vault search now merges full-text results with direct filename/path matches, so queries like
  `readme.md` can find files even when the filename is not present in file content.
- The desktop reader now avoids rendering failed download responses as Markdown preview text.
- The desktop app now reconciles the selected reader file after vault reloads, so deleted files do
  not stay selected after the list refreshes.

## Verified

Last verified on 2026-05-01:

- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`
- `npm.cmd test` passed with 67 tests.
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run format:check`

Manual smoke verified:

- Desktop app reaches the local Worker.
- Desktop and Worker auth work when `VITE_AUTH_TOKEN` and `OPENBRAIN_AUTH_TOKEN` match locally.
- Manual Markdown import works.
- Imported files appear in List view.
- Imported files open in the reader.
- Content search for text inside a Markdown file worked in the desktop app before the filename
  search fix.
- Filename/path search is covered by Worker route tests after this fix; rerun browser smoke for
  `testrename.md` in the next app session to confirm the full UI path.
- Rename worked in the desktop app before this fix.
- Delete removed the file from the list; this fix improves the stale selected-reader state after
  deletion.
- Review Inbox loads and shows the correct empty state when no pending suggestions exist.
- Graph loads without crashing with the current one-file vault.
- Settings masks the local auth token.

## Local Setup Notes

- Do not commit local secrets.
- Desktop local env lives in `apps/desktop/.env.local`.
- Worker local env lives in `services/worker/.dev.vars`.
- The desktop token `VITE_AUTH_TOKEN` must match the Worker token `OPENBRAIN_AUTH_TOKEN`.
- Wrangler uses `.dev.vars` plural, not `.dev.var`.
- `SUPABASE_SERVICE_KEY` belongs only in Worker/local server env, never in the desktop env.

## Next Targets

Start with the working import/list/reader loop and move outward:

1. Browser-smoke the latest search and reader fixes:
   - Search for text inside an imported Markdown file.
   - Search for the imported file name, such as `testrename.md`.
   - Delete a scratch file and confirm the reader clears instead of showing raw `Not found`.
2. Move to Review Inbox and Architect suggestions:
   - Run `services/architect-agent` jobs against imported files.
   - Confirm pending suggestions appear in Review Inbox.
   - Confirm approving/rejecting suggestions updates Worker/Supabase state correctly.
3. Verify approved relationship surfaces:
   - Create or approve at least one link suggestion.
   - Confirm approved links appear in the reader and Graph view.
4. Verify vault-grounded Architect chat:
   - Ask a question answerable from imported vault content and confirm source citations.
   - Ask an unsupported question and confirm The Architect refuses unsupported vault claims.

## Guardrails

- Do not touch secrets, auth logic, database migrations, payments, or deployment config without an
  explicit warning and approval.
- Do not reintroduce folder sync into v1 without a product decision.
- Do not allow The Architect to silently move, delete, rename, tag, summarize, or link files.
- Keep changes simple and scoped. Prefer proving the current product loop before adding new
  architecture.
