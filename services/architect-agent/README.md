# architect-agent

Dedicated OpenBrain scripts for The Architect. These jobs are separate from OpenClaw and only
operate on OpenBrain vault data through the Worker API.

## Setup

1. Create a local `.env` with the Worker URL, auth token, and LLM provider keys.
2. Install deps from the repo root with `npm install`.
3. Test a run manually:
   ```
   source .env && npm run link
   source .env && npm run tag
   ```
4. Run The Architect from your scheduler of choice:
   ```
   0 * * * * cd /path/to/OpenBrain/services/architect-agent && source .env && npm run run
   ```

## What each script does

| Script               | Purpose                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/jobs/linker.ts` | Embeds new files, finds nearest neighbors, asks The Architect if they are related, and proposes links |
| `src/jobs/tagger.ts` | Creates reviewable folder/tag suggestions for unorganized files                                       |

## Review workflow

The Review Inbox is the primary approval surface. The Architect writes suggestions and links for the
user to approve or reject before they shape the vault.

## Providing corrections

When The Architect suggests the wrong folder or tags:

1. Move or fix it in the app.
2. The app logs the correction via `POST /corrections`.
3. The next tagger run includes recent corrections in the prompt.

## Embedding providers

Set `EMBEDDING_PROVIDER` in `.env`:

- `voyage` - high-quality embeddings. Needs `VOYAGE_API_KEY`.
- `openai` - good alternative. Needs `OPENAI_API_KEY`.

LLM keys belong in this service environment or Worker secrets. Do not put them in the desktop app.
