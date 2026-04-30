# OpenBrain

A personal knowledge-management system for importing files, browsing a cloud-backed vault, approving AI-suggested connections, and surfacing knowledge via semantic search.

See [PRD.md](PRD.md) for the product guardrail and [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) for a plain-English repo map.

## Architecture

```
apps/desktop/          Tauri 2 (Windows/Mac) — file watcher, R2 sync, React UI
services/worker/       Cloudflare Worker — REST API over Supabase + R2
services/friday-cron/  AI cron jobs — embedding, linking, tagging (Claude / Voyage)
infra/supabase/        Postgres schema (pgvector) + SQL migrations
packages/shared/       Shared TypeScript types
```

**Data flow:** Desktop imports selected files or optionally watches a vault folder → uploads files to Cloudflare Worker → Worker stores blobs in R2 and metadata in Supabase → Friday cron embeds each file, finds semantic neighbors, asks Claude if they're related, proposes links → you approve/reject suggestions in the review workflow.

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
