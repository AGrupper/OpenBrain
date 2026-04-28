Set up the OpenBrain friday-cron on this Mac. Follow these steps exactly.

**Step 1 — Read secrets from Apple Notes**

Open the note called `.env` in Apple Notes. You need: `OPENBRAIN_AUTH_TOKEN`.

**Step 2 — Clone the repo**

```bash
git clone https://github.com/AGrupper/OpenBrain.git ~/OpenBrain
cd ~/OpenBrain && npm install
```

If `~/OpenBrain` already exists: `cd ~/OpenBrain && git pull && npm install`

**Step 3 — Pull the Ollama embedding model**

```bash
ollama pull mxbai-embed-large
```

Gemma4 is already installed. This adds the embedding model (1024-dim, required for file linking).

**Step 4 — Check your Gemma4 model name in Ollama**

```bash
ollama list
```

Note the exact name (e.g. `gemma4`, `gemma4:latest`, `gemma3:4b`).

**Step 5 — Create the cron env file**

```bash
cp ~/OpenBrain/services/friday-cron/.env.example ~/OpenBrain/services/friday-cron/.env
```

Edit it and set these values:

```
OPENBRAIN_API_URL=https://openbrain-worker.openbrain.workers.dev
OPENBRAIN_AUTH_TOKEN=<from Apple Notes>
EMBEDDING_PROVIDER=ollama
OLLAMA_EMBEDDING_MODEL=mxbai-embed-large
FRIDAY_MODEL_PROVIDER=ollama
FRIDAY_MODEL=<exact name from ollama list>
MAX_FILES_PER_RUN=20
```

Leave `VOYAGE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` blank.

**Step 6 — Install deps and run a manual test**

```bash
cd ~/OpenBrain/services/friday-cron
npm install
source .env && npm run tag
source .env && npm run link
```

Both should print `Starting run` and complete without errors. Show me the full output if anything fails.

**Step 7 — Schedule hourly via crontab**

```bash
crontab -e
```

Add this line:

```
0 * * * * cd ~/OpenBrain/services/friday-cron && source .env && npm run link && npm run tag >> ~/OpenBrain/friday-cron.log 2>&1
```

Do not build the desktop app. Report back when done or if anything fails.
