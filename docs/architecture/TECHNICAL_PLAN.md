# OpenBrain Technical Plan: The Architect Vault System

## Summary

OpenBrain is a cloud-backed personal knowledge vault with a dedicated AI agent called **The
Architect**. The Architect is owned by OpenBrain, not OpenClaw, and its job is to organize, connect,
explain, and retrieve knowledge from the vault.

Manual file import and in-app note creation are the v1 ingestion paths. Folder sync and local folder
mirroring are not part of v1.

## Architecture

- **Desktop app:** Tauri 2, React, Vite, and TypeScript. Handles manual import, persistent folder
  explorer, file reader, graph view, Review Inbox, search, settings, and Architect chat.
- **Native desktop layer:** Rust Tauri commands for local file selection/import. It uploads selected
  files to the Worker and does not run a folder watcher.
- **Cloud API:** Cloudflare Worker routes for files, links, search, corrections, Architect jobs,
  Architect suggestions, and Architect chat.
- **Storage:** Cloudflare R2 stores original files. Supabase Postgres stores metadata, extracted
  text, summaries, tags, links, suggestions, chat history, and embeddings.
- **Vector search:** `pgvector` supports semantic neighbors and retrieval.
- **The Architect:** `services/architect-agent` runs dedicated OpenBrain background jobs. LLM API
  keys live in Worker/job-runner secrets, never in the desktop app.

## File And AI Flow

1. User imports local files from the desktop app.
2. Tauri reads selected files and uploads them to `/files/upload`.
3. The Worker stores the original in R2 and metadata in Supabase.
4. The Worker creates an `architect_jobs` row for the imported file.
5. The Architect creates embeddings, searches neighbors, and writes reviewable suggestions.
6. The Review Inbox shows pending links, folder suggestions, tag suggestions, summaries, actions,
   and cleanup suggestions.
7. The user approves or rejects each suggestion.
8. Approved links appear in the reader and graph.

The List view is a cloud vault explorer. Folders are persistent Supabase records, while files remain
cloud objects in R2 plus metadata rows in Supabase. Creating a blank Markdown note writes the R2
object and matching `files` row directly through the Worker.

## Architect Chat

Architect chat is retrieval-augmented over vault data.

1. User asks a question inside the app.
2. The Worker retrieves vault sources from search/vector data.
3. The LLM receives only the retrieved snippets and the Architect system prompt.
4. If the retrieved vault context is insufficient, The Architect must say it does not know from the
   vault.
5. Answers include source references to vault files.
6. Chat messages and answer sources are stored for history and auditability.

The LLM still has pretrained knowledge, so the enforceable product rule is source grounding: answer
from provided vault context, cite sources, and refuse unsupported claims.

## Data Model

- `folders`: persistent empty or populated cloud vault folders.
- `files`: original vault file metadata, extracted text, tags, folder, and summary.
- `embeddings`: one vector row per file.
- `links`: approved, rejected, pending, or auto-approved file relationships.
- `architect_jobs`: background processing state for imported files.
- `architect_suggestions`: reviewable Architect suggestions.
- `architect_chat_sessions`: chat conversations.
- `architect_chat_messages`: user and Architect messages.
- `architect_chat_message_sources`: vault files used to support an Architect answer.

## API Surface

- `/folders`: list, create, and delete empty persistent folders.
- `/files`: upload, create text Markdown notes, list, fetch metadata, download, update, delete,
  embedding, neighbors.
- `/links`: proposed and approved file connections.
- `/search`: keyword search, with semantic retrieval layered in over time.
- `/corrections`: user correction history for future Architect behavior.
- `/architect/jobs`: create, list, and update Architect processing jobs.
- `/architect/suggestions`: create, list, approve, and reject Architect suggestions.
- `/architect/chat`: vault-grounded chat with The Architect.
- `/architect/chat/:sessionId/messages`: chat history.

## Guardrails

- The desktop app must never receive LLM provider API keys.
- The Architect must not silently move, delete, rename, tag, summarize, or link files.
- The Architect should prefer existing folders and tags before creating new structure.
- Folder sync is out of v1 unless explicitly reintroduced later.
- Folder rename and move are deferred until recursive R2 object moves and database path updates are
  designed deliberately.
- OpenClaw is not part of OpenBrain vault processing.
