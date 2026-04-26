# OpenBrain — Cloud Setup

Follow these steps to go from a working local repo to a running cloud app.

---

## Before cloud setup — local pre-flight

Run these checks locally first. Do not proceed to cloud steps until all pass.

```bash
# From repo root:
npm test
npm run typecheck
npm run lint
npm run format:check
```

If cargo is available:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
```

Manual check:

- Start the desktop app (`npm run tauri:dev` inside `apps/desktop`)
- Confirm the "Choose vault folder" button appears and clicking it opens a folder picker
- Confirm selecting a folder starts sync without errors

**Secrets:** Never paste API keys or tokens into chat. Set all secrets locally via environment variables or `wrangler secret put`.

---

## Step 0 — Install VS C++ Build Tools (one-time, ~5 min)

Tauri requires the MSVC C++ compiler. Open **Visual Studio Installer** → find VS 2022 → click **Modify** → check **Desktop development with C++** → Install.

This adds `cl.exe` and `msvcrt.lib` which Rust needs to compile the desktop app.

After installing, run once in a VS Developer Command Prompt (or a new terminal) to confirm:

```
cl /?
```

---

## Step 1 — Sign up for Cloudflare (5 min)

1. Go to https://dash.cloudflare.com/sign-up
2. Verify email, log in
3. Go to **R2 Object Storage** → Create bucket → Name it `openbrain-vault`
4. Note your **Account ID** (top-right in the dashboard URL or account home)
5. Create an **R2 API Token**: R2 → Manage R2 API Tokens → Create Token with Read+Write on `openbrain-vault`
   - Save the **Access Key ID** and **Secret Access Key** (shown only once)

---

## Step 2 — Sign up for Supabase (3 min)

1. Go to https://supabase.com → Sign up
2. Create a new project (free tier) — pick any region closest to you
3. Wait for the project to spin up (~1 min)
4. Go to **Project Settings** → **Data API**:
   - Copy **Project URL** → `SUPABASE_URL`
   - Copy **service_role** key (NOT the anon key) → `SUPABASE_SERVICE_KEY`
5. Go to **SQL Editor** → paste and run both migrations:
   - First: copy-paste contents of `infra/supabase/migrations/001_initial.sql`
   - Then: copy-paste contents of `infra/supabase/migrations/002_functions.sql`

---

## Step 3 — Telegram bot token (1 min)

1. Open Telegram → search `@BotFather` → `/newbot` (skip if you already have one)
2. Note your bot token (format: `123456789:AABB...`)
3. Get your personal chat ID: message `@userinfobot` → it shows your ID number
   - Or start a conversation with your bot and visit:
     `https://api.telegram.org/bot<TOKEN>/getUpdates` after sending it a message

---

## Step 4 — Choose your auth token (30 sec)

Pick a long random string — this is the shared secret between the app and Worker:

```
openssl rand -hex 32
```

Save it as `OPENBRAIN_AUTH_TOKEN`.

---

## Step 5 — Deploy the Cloudflare Worker (3 min)

```bash
cd services/worker
npm install
# Set secrets (run each line, paste value when prompted):
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put OPENBRAIN_AUTH_TOKEN
# Deploy:
npm run deploy
```

You'll get a Worker URL like `https://openbrain-worker.your-name.workers.dev`

---

## Step 6 — Register the Telegram webhook (30 sec)

Replace placeholders and run in your browser or curl:

```
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://openbrain-worker.your-name.workers.dev/telegram/<TELEGRAM_BOT_TOKEN>
```

Expected response: `{"ok":true,"result":true,...}`

---

## Step 7 — Run the desktop app (3 min)

```bash
cd apps/desktop
# Create env file:
echo "VITE_API_URL=https://openbrain-worker.your-name.workers.dev" > .env.local
echo "VITE_AUTH_TOKEN=your-OPENBRAIN_AUTH_TOKEN" >> .env.local
npm install
npm run tauri:dev
```

The app will open. Use the folder picker to choose your vault directory.

---

## Step 8 — Set up Friday's cron (2 min)

```bash
cd services/friday-cron
npm install
cp .env.example .env
# Edit .env with your values (API URL, auth token, and Friday's model API keys)
```

Tell Friday (via Telegram or Openclaw) to run this hourly:

```
cd /path/to/OpenBrain/services/friday-cron && source .env && npm run link && npm run tag
```

---

## Step 9 — Build Mac app (on your MacBook, 5 min)

```bash
# On your Mac:
git clone <your-repo-or-copy-files> OpenBrain
cd OpenBrain/apps/desktop
# Install Rust if not present: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
npm install
npm run tauri:build
# Installer is in src-tauri/target/release/bundle/dmg/
```

---

## Smoke tests

After setup, verify each phase:

| Phase   | Test                                                                            |
| ------- | ------------------------------------------------------------------------------- |
| Sync    | Drop a .md file in your vault folder → confirm it appears in the app within 60s |
| Search  | Type a word from one of your files in the search bar → see it appear            |
| Linking | Wait 1 hour → check Telegram for a link proposal from Friday                    |
| Graph   | Switch to Graph view → see nodes and edges                                      |
| Tagging | Check a file → verify Friday set a folder and tags                              |

---

## Cost estimate (steady state)

| Service                      | Cost            |
| ---------------------------- | --------------- |
| Cloudflare R2 (50 GB)        | ~$0.75/month    |
| Supabase free tier           | $0              |
| Cloudflare Workers free tier | $0              |
| AI usage (Friday's keys)     | Already covered |
| **Total**                    | **~$1/month**   |
