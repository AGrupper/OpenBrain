# OpenBrain Cloud Setup

Follow these steps to go from a working local repo to a running cloud app.

## Before Cloud Setup

Run these checks locally first:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
```

If Rust is available:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
```

Manual check:

- Start the desktop app with `npm run tauri:dev` inside `apps/desktop`.
- Confirm the import bar appears.
- Click `Add files` and import a small Markdown or text file.
- Confirm the file appears in the vault list.

Never paste API keys or tokens into chat. Set secrets locally through environment variables,
`.env.local`, or `wrangler secret put`.

For local Worker development, Wrangler reads `services/worker/.dev.vars`. A `services/worker/.env`
file is not enough for `wrangler dev` unless you explicitly load it yourself.

## Step 1: Desktop Build Tools

Tauri requires the MSVC C++ compiler on Windows. Install **Desktop development with C++** from the
Visual Studio Installer, then confirm `cl /?` works in a new terminal.

## Step 2: Cloudflare R2

1. Create a Cloudflare account.
2. Create an R2 bucket named `openbrain-vault`.
3. Note your Cloudflare Account ID.
4. Create an R2 API token with read/write access to the bucket.

## Step 3: Supabase

1. Create a Supabase project.
2. Copy the Project URL as `SUPABASE_URL`.
3. Copy the `service_role` key as `SUPABASE_SERVICE_KEY`.
4. Run the SQL migrations in order:
   - `infra/supabase/migrations/001_initial.sql`
   - `infra/supabase/migrations/002_functions.sql`
   - `infra/supabase/migrations/003_architect.sql`

## Step 4: Auth Token

Create a long random token for the desktop app and Worker:

```bash
openssl rand -hex 32
```

Save it as `OPENBRAIN_AUTH_TOKEN`.

## Step 5: Deploy Worker

```bash
cd services/worker
npm install
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put OPENBRAIN_AUTH_TOKEN
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ARCHITECT_MODEL
npm run deploy
```

`OPENAI_API_KEY` and `ARCHITECT_MODEL` are server-side Architect secrets. They must not be exposed to
the desktop app.

Telegram secrets are optional and only needed if you keep Telegram approval notifications:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

## Step 6: Desktop App

```bash
cd apps/desktop
echo "VITE_API_URL=https://openbrain-worker.your-name.workers.dev" > .env.local
echo "VITE_AUTH_TOKEN=your-OPENBRAIN_AUTH_TOKEN" >> .env.local
npm install
npm run tauri:dev
```

The desktop app should open with manual file import. There is no folder sync in v1.

## Step 7: The Architect Jobs

```bash
cd services/architect-agent
npm install
# Create a local .env with OPENBRAIN_API_URL, OPENBRAIN_AUTH_TOKEN, and provider keys.
npm run link
npm run tag
```

Run these jobs from your scheduler of choice. They are OpenBrain jobs, not OpenClaw agents.

## Smoke Tests

| Phase          | Test                                                               |
| -------------- | ------------------------------------------------------------------ |
| Import         | Add a `.md` file from the desktop app and confirm it appears       |
| Search         | Search for text from the imported file                             |
| Architect jobs | Run `npm run link` and `npm run tag` in `services/architect-agent` |
| Review         | Confirm pending suggestions appear in the Review Inbox             |
| Graph          | Approve a link and confirm it appears in Graph view                |
| Chat           | Ask The Architect about imported content and confirm citations     |

## Cost Estimate

| Service                      | Cost        |
| ---------------------------- | ----------- |
| Cloudflare R2 (50 GB)        | About $1/mo |
| Supabase free tier           | $0          |
| Cloudflare Workers free tier | $0          |
| Cloud AI usage               | Usage-based |
