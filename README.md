# OpenBrain

A personal knowledge-management system for importing files, browsing a cloud-backed vault, approving AI-suggested connections, and surfacing knowledge via semantic search.

Start with [PRD.md](PRD.md) for the product direction and [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) for a plain-English repo map.

## Architecture

```text
apps/desktop/          Tauri 2 desktop app: import, optional folder sync, reader, graph
services/worker/       Cloudflare Worker API over Supabase + R2
services/friday-cron/  AI cron jobs: embedding, linking, tagging
infra/supabase/        Postgres schema and vector-search migrations
packages/shared/       Shared TypeScript types
```

## Data Flow

1. The desktop app imports selected files or optionally watches a vault folder.
2. Files upload to the Worker API.
3. The Worker stores originals in R2 and metadata in Supabase.
4. Friday cron embeds files, finds semantic neighbors, and proposes links.
5. The user approves or rejects suggestions in the review workflow.
6. Approved links appear in the reader and graph.

## Local Commands

```bash
# Install all dependencies
npm install

# Run all tests
npm test

# Type-check all packages
npm run typecheck

# Lint
npm run lint

# Format check
npm run format:check

# Desktop dev (requires Rust + MSVC toolchain; see infra/SETUP.md)
npm run dev:desktop

# Worker dev
npm run dev:worker
```

## Secrets

Never paste API keys or tokens into chat. Set them locally through environment variables, `.env.local`, or `wrangler secret put`. See [infra/SETUP.md](infra/SETUP.md) for deployment setup.
