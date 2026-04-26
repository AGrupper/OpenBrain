# OpenBrain Overnight Build Log

## State machine

On resume: read the latest entry in this file to find where to continue.

---

## [2026-04-25] Session start

- Rust 1.95 installed
- git repo initialized
- Directory structure created
- Next: write shared types, then Postgres migrations, then Worker routes, then Tauri app

## [2026-04-26] All 5 phases complete — BUILD DONE

**Committed:** 40d86b1 — 48 files, ~16,500 lines

### What was built

- `packages/shared` — all TypeScript types (VaultFile, Link, SearchResult, Correction, etc.)
- `infra/supabase/migrations/` — 001_initial.sql (tables, FTS, pgvector), 002_functions.sql (neighbors, search_files, increment_trust RPCs)
- `services/worker` — Cloudflare Worker: /files, /links, /search, /corrections, /telegram (Telegram inline-keyboard webhook)
- `services/friday-cron` — linker.ts (embed + propose, Voyage/OpenAI abstracted), tagger.ts (folder + tags with correction learning)
- `apps/desktop` — Tauri 2 app: ListView, GraphView (react-force-graph-2d), SearchBar (debounced, snippet highlights), Rust sync engine (notify watcher, SHA-256, R2 upload/download, 60s poll)
- `infra/SETUP.md` — full morning checklist

### TypeScript: clean. Rust: blocked (see below).

### Blockers — user action needed

1. **VS C++ Build Tools** — install "Desktop development with C++" in VS Installer → Modify → check that workload. Required for Rust/Tauri. See SETUP.md Step 0.
2. **Cloud accounts** — Cloudflare + Supabase + Telegram bot. See SETUP.md Steps 1–5.
3. **GitHub repo** — create at github.com then: `git remote add origin <url> && git push -u origin master`

### Resuming

~~Nothing left to build. Follow SETUP.md to go live.~~ (outdated — see 2026-04-26 entry below)

---

## [2026-04-26] Local stabilization complete — ready for cloud setup

**All pre-flight checks pass:** `npm test` (44 tests), `npm run typecheck`, `npm run lint`, `npm run format:check`, `cargo build`, `cargo clippy` (clean).

### What was fixed

- **CI:** Added `apps/desktop/src-tauri/gen` to `.prettierignore` — generated Tauri schemas no longer trip `format:check`
- **Worker `GET /files`:** Now correctly filters `needs_linking`, `needs_tagging`, `needs_embedding`; supports `limit` (clamped 500) and `select` with a column whitelist — Friday cron queries now work as intended
- **Embedding dimensions:** Worker rejects wrong-dimension payloads (expects 1024); linker requests `dimensions: 1024` from OpenAI and validates length before posting
- **Linker lifecycle:** `needs_linking` is now cleared after a successful embed + neighbor scan — files no longer re-process forever
- **Desktop sync UI:** `App.tsx` now calls `get_vault_path`, `start_sync`, `stop_sync` via Tauri `invoke`; folder picker via `@tauri-apps/plugin-dialog`; SyncBar shows path, status dot, and Stop button
- **SearchBar XSS:** Replaced `dangerouslySetInnerHTML` with safe `highlightSnippet()` React node parser
- **Docs:** README written; `infra/SETUP.md` updated with pre-flight section; `.env.example` drops false `anthropic` embedding provider
- **tauri.conf.json:** Removed invalid `plugins.dialog/shell` empty-map config that prevented startup; removed invalid `plugins.fs.scope` field

### Smoke test: passed

Desktop app opened, SyncBar visible, folder picker opened natively, `start_sync` called successfully (green "Syncing" state), Stop button rendered.

### Next

Follow `infra/SETUP.md` — cloud setup (Cloudflare, Supabase, Telegram, Worker deploy).
