# OpenBrain

A personal knowledge-management system that syncs your local vault to the cloud, links related notes automatically, and surfaces connections via semantic search.

## Architecture

```
apps/desktop/          Tauri 2 (Windows/Mac) — file watcher, R2 sync, React UI
services/worker/       Cloudflare Worker — REST API over Supabase + R2
services/friday-cron/  AI cron jobs — embedding, linking, tagging (Claude / Voyage)
infra/supabase/        Postgres schema (pgvector) + SQL migrations
packages/shared/       Shared TypeScript types
```

**Data flow:** Desktop watches your vault folder → uploads new/changed files to Cloudflare Worker → Worker stores blobs in R2 and metadata in Supabase → Friday cron embeds each file, finds semantic neighbors, asks Claude if they're related, proposes links via Telegram → you approve/reject in Telegram.

## Status

Local stabilization in progress. All five phases are scaffolded. See [infra/SETUP.md](infra/SETUP.md) for the pre-flight checklist before cloud setup.

## Local commands

```bash
# Install all deps from repo root
npm install

# Run all tests
npm test

# Type-check all packages
npm run typecheck

# Lint
npm run lint

# Format check (must pass before cloud deploy)
npm run format:check

# Desktop dev (requires Rust + MSVC toolchain — see SETUP.md Step 0)
cd apps/desktop && npm run tauri:dev

# Worker dev (Cloudflare wrangler local mode)
cd services/worker && npm run dev
```

## Secrets

Never paste API keys or tokens into chat. Set them locally via environment variables or `wrangler secret put`. See [infra/SETUP.md](infra/SETUP.md) for the full deployment checklist.
