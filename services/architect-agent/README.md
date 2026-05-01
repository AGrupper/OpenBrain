# architect-agent

Dedicated OpenBrain scripts for The Architect. These jobs are separate from OpenClaw and only
operate on OpenBrain vault data through the Worker API.

## Setup

1. Create a local `.env` with the Worker URL, auth token, and provider keys when using real
   providers.
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

## Deterministic smoke mode

Use this mode to prove the local Architect review loop without paid model providers. It does not
call OpenAI, Anthropic, Gemini, DeepSeek, Voyage, or Ollama.

1. Start the local Worker and desktop app with matching local auth tokens.
2. Import disposable markdown files with names like:
   - `openbrain-smoke-related-a.md`
   - `openbrain-smoke-related-b.md`
   - `openbrain-smoke-unrelated.md`
   - `openbrain-smoke-organization.md`
3. In PowerShell, load only the Worker URL and auth token needed to reach the local Worker:
   ```powershell
   $env:OPENBRAIN_API_URL = "http://127.0.0.1:8787"
   $env:OPENBRAIN_AUTH_TOKEN = "<same local token as the Worker>"
   npm run smoke:run
   ```
4. Open Review Inbox and approve/reject the generated suggestions and link proposal.
5. Confirm approved folder/tags appear after reload, the approved link appears in the reader and
   Graph view, and the disposable test files can be deleted safely.

The smoke provider returns deterministic folder/tag suggestions, 1024-dimension fake embeddings,
and relatedness decisions for clearly named disposable test files.

## Providing corrections

When The Architect suggests the wrong folder or tags:

1. Move or fix it in the app.
2. The app logs the correction via `POST /corrections`.
3. The next tagger run includes recent corrections in the prompt.

## Embedding providers

Set `EMBEDDING_PROVIDER` in `.env`:

- `voyage` - high-quality embeddings. Needs `VOYAGE_API_KEY`.
- `openai` - good alternative. Needs `OPENAI_API_KEY`.
- `deterministic` - local smoke mode only. Uses fake 1024-dimension vectors and no API key.

LLM keys belong in this service environment or Worker secrets. Do not put them in the desktop app.
