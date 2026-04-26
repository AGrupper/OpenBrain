# friday-cron

Scripts Friday runs on an hourly schedule to keep OpenBrain linked, tagged, and organized.

## Setup

1. Copy `.env.example` to `.env` and fill in your values
2. Install deps: `npm install`
3. Test a run manually:
   ```
   source .env && npm run link
   source .env && npm run tag
   ```
4. Add to Friday's hourly Openclaw cron:
   ```
   # In your Openclaw cron config or system cron:
   0 * * * * cd /path/to/OpenBrain/services/friday-cron && source .env && npm run link && npm run tag
   ```

## What each script does

| Script      | Purpose                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `linker.ts` | Embeds new files, finds nearest neighbors, asks Friday if they're related, proposes links via Telegram |
| `tagger.ts` | Asks Friday to suggest a folder path and tags for unorganized files                                    |

## Trust threshold

Once you approve 50 obvious links (confidence ≥ 85%) in Telegram, future obvious links are auto-approved silently.
Loose links (65–85%) always go through Telegram.

## Providing corrections

When Friday puts a file in the wrong folder or adds wrong tags:

1. Move/fix it in the app
2. The app automatically logs the correction via `POST /corrections`
3. Next time tagger.ts runs, it includes your recent corrections in the prompt

## Embedding providers

Set `EMBEDDING_PROVIDER` in `.env`:

- `voyage` — Anthropic-recommended, best quality. Needs `VOYAGE_API_KEY`
- `openai` — Good alternative. Needs `OPENAI_API_KEY`

If Friday already has embedding access through her model provider, you can add a new provider
in `linker.ts` under the `embedText` function.
