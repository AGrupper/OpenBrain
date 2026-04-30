# OpenBrain Project Structure

This file explains the repository in plain English. Start here when you want to understand where things live.

## The Product Goal

Read `PRD.md` first. It defines what OpenBrain is supposed to become: a personal AI knowledge vault, not a generic file drive.

## Main Areas

### `apps/desktop`

The desktop app. This is the part you see and use.

- `src/App.tsx` controls the main screen, top navigation, file import, sync status, and view switching.
- `src/views/ListView.tsx` shows the folder/list vault view and file reader.
- `src/views/GraphView.tsx` shows approved file connections as a graph.
- `src/views/SearchBar.tsx` searches the vault.
- `src/views/ReviewInbox.tsx` lets you approve or reject AI-suggested links.
- `src-tauri/src` contains the native desktop code for local file access, folder sync, and import commands.

### `services/worker`

The cloud API. The desktop app talks to this service.

- `src/routes/files.ts` handles file upload, download, metadata, and file search flags.
- `src/routes/links.ts` handles suggested and approved connections between files.
- `src/routes/search.ts` handles vault search.
- `src/telegram` handles Telegram approval callbacks where that workflow is used.

### `services/friday-cron`

The background AI processing jobs.

- `linker.ts` finds semantic neighbors and proposes links.
- `tagger.ts` suggests folders and tags.
- Tests in this folder protect the AI workflow behavior without calling real providers.

### `packages/shared`

Shared TypeScript types used by multiple parts of the project.

### `infra`

Setup and database infrastructure.

- `supabase/migrations` defines the database schema and search/vector functions.
- `SETUP.md` contains deployment and environment setup notes.

### `docs`

Product and supporting documentation.

The root `PRD.md` is the canonical product direction. Docs here can expand on it without replacing it.

## How The App Works

1. The desktop app imports selected files or optionally syncs a local folder.
2. Files are uploaded to the Worker API.
3. The Worker stores originals in R2 and metadata in Supabase.
4. Background jobs create embeddings, suggest tags/folders, and propose links.
5. The user approves meaningful suggestions in the Review Inbox.
6. Approved links appear in the reader and graph.

## What Not To Change Casually

- Do not remove manual file import; it is a core PRD requirement.
- Do not make folder sync the only ingestion path.
- Do not let AI suggestions silently reorganize the vault.
- Do not move major folders without updating workspace config, imports, tests, and this map.
