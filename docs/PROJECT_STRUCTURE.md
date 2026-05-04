# OpenBrain Project Structure

This file explains the repository in plain English. Start here when you want to understand where
things live. For current session state, read `docs/SESSION_CONTEXT.md`.

## The Product Goal

Read `docs/PRD.md` first. It defines what OpenBrain is supposed to become: a personal AI knowledge vault, not a generic file drive.

## Main Areas

### Root

The root is intentionally small. It keeps files that common tools expect at the top level, such as
workspace package files, Git ignores, formatter/linter configs, and the GitHub-facing `README.md`.
Product, architecture, setup, and project-status documents live directly under `docs`.

### `docs`

The docs folder is intentionally flat so it is easy to browse from the editor sidebar.

- `PRD.md` defines the product direction.
- `TECHNICAL_PLAN.md` explains the architecture.
- `MASTER_PLAN.md` tracks the durable roadmap.
- `SESSION_CONTEXT.md` tracks recent session state and next steps.
- `PROJECT_STRUCTURE.md` is this repo map.
- `CLOUD_SETUP.md` documents local/cloud setup.

### `apps/desktop`

The desktop app. This is the part you see and use.

- `src/app/App.tsx` wires the main screen together.
- `src/app/main.tsx` is the desktop frontend entry point.
- `src/features/vault` contains the PARA file explorer, reader, and import controls.
- `src/features/graph` contains the graph view.
- `src/features/search` contains vault search.
- `src/features/review` contains the Review Inbox.
- `src/features/architect-chat` contains vault-grounded Architect chat.
- `src/features/settings` contains local app settings and theme controls.
- `src/shared/api/api.ts` is the desktop app's API client.
- `src/shared/components` contains reusable app chrome such as the header.
- `src/shared/styles/index.css` contains global desktop styling.
- `src-tauri/src` contains the native desktop code for local file import commands.

### `services/worker`

The cloud API. The desktop app talks to this service.

- `src/routes/files.ts` handles file upload, download, metadata, and file search flags.
- `src/routes/links.ts` handles suggested and approved connections between files.
- `src/routes/architect.ts` handles Architect jobs, suggestions, and vault-grounded chat.
- `src/routes/search.ts` handles vault search.
- `src/telegram` handles Telegram approval callbacks where that workflow is used.

### `services/architect-agent`

The dedicated OpenBrain AI processing jobs. This is The Architect, not OpenClaw.

- `src/jobs/linker.ts` finds semantic neighbors and proposes links.
- `src/jobs/tagger.ts` creates reviewable folder and tag suggestions.
- `tests` protects the AI workflow behavior without calling real providers.

### `packages/shared`

Shared TypeScript types used by multiple parts of the project.

### `infra`

Setup and database infrastructure.

- `supabase/migrations` defines the database schema and search/vector functions.
- Setup docs live directly under `docs`.

## How The App Works

1. The desktop app imports selected files.
2. Files are uploaded to the Worker API.
3. The Worker stores originals in R2 and metadata in Supabase.
4. The Worker creates an Architect job for the imported file.
5. Background jobs create embeddings, suggest tags/folders, and propose links.
6. The user approves meaningful suggestions in the Review Inbox.
7. Approved links appear in the reader and graph.
8. Architect chat retrieves vault sources and answers with citations.

## What Not To Change Casually

- Do not remove manual file import; it is a core PRD requirement.
- Do not reintroduce folder sync into v1 without an explicit product decision.
- Do not let AI suggestions silently reorganize the vault.
- Do not move major folders without updating workspace config, imports, tests, and this map.
