# OpenBrain

A personal knowledge-management system for importing files, browsing a cloud-backed vault, chatting with The Architect, approving AI-suggested structure, and surfacing knowledge via semantic search.

Start with [docs/PRD.md](docs/PRD.md) for the product direction, [docs/TECHNICAL_PLAN.md](docs/TECHNICAL_PLAN.md) for the architecture, and [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) for a plain-English repo map.

## Architecture

```text
apps/desktop/          Tauri 2 desktop app: manual import, reader, graph, review, Architect chat
services/worker/       Cloudflare Worker API over Supabase + R2
services/architect-agent/  The Architect jobs: embedding, linking, reviewable suggestions
infra/supabase/        Postgres schema and vector-search migrations
packages/shared/       Shared TypeScript types
```

## Data Flow

1. The desktop app imports selected local files.
2. Files upload to the Worker API.
3. The Worker stores originals in R2 and metadata in Supabase.
4. The Worker creates Architect jobs for new files.
5. The Architect embeds files, finds semantic neighbors, and writes reviewable suggestions.
6. The user approves or rejects suggestions in the Review Inbox.
7. Approved links appear in the reader and graph.
8. Architect chat answers only from retrieved vault sources and cites those sources.

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

# Desktop dev (requires Rust + MSVC toolchain; see docs/CLOUD_SETUP.md)
npm run dev:desktop

# Worker dev
npm run dev:worker
```

## Secrets

Never paste API keys or tokens into chat. Set them locally through environment variables, `.env.local`, or `wrangler secret put`. See [docs/CLOUD_SETUP.md](docs/CLOUD_SETUP.md) for deployment setup.
