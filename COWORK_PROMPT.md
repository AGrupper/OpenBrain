Two tasks: fix the launchd cron (it's currently broken) and verify the OpenBrain desktop app works on this Mac. Report back after each part.

## Part A — Fix the launchd plist

The hourly cron job is registered but its bash command is broken: it uses `source .env` without `set -a`, so npm subprocesses don't see the env vars and every run fails with `TypeError: Failed to parse URL from undefined/files...`.

**Fix:**

```bash
launchctl unload ~/Library/LaunchAgents/com.openbrain.friday-cron.plist
```

Open `~/Library/LaunchAgents/com.openbrain.friday-cron.plist` in a text editor. Find the line containing `source .env && npm run link && npm run tag`. Replace it with:

```
cd ~/OpenBrain/services/friday-cron && set -a && source .env && set +a && npm run link && npm run tag
```

(The whole thing is one bash command inside a `<string>` element. Don't change anything else — just that string.)

Save, then reload:

```bash
launchctl load ~/Library/LaunchAgents/com.openbrain.friday-cron.plist
launchctl list | grep openbrain
```

Force one immediate run to confirm the fix:

```bash
launchctl start com.openbrain.friday-cron
sleep 8
tail -30 ~/OpenBrain/friday-cron.log
```

Expected: lines like `[linker] Starting run at ...` and `[tagger] Starting run at ...` with no `TypeError` or `Failed to parse URL`. If you see those errors, the plist edit didn't take — check the file again.

---

## Part B — Verify the OpenBrain desktop app on this Mac

**Step 1 — Pull latest code**

```bash
cd ~/OpenBrain
git pull
npm install
```

**Step 2 — Toolchain check**

```bash
cargo --version
node --version
```

Both must work. If `cargo` is missing: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` and re-open the terminal.

**Step 3 — Create the desktop env file**

Read `OPENBRAIN_AUTH_TOKEN` from Apple Notes `.env` (same one you used for the cron). Create `~/OpenBrain/apps/desktop/.env.local` with:

```
VITE_API_URL=https://openbrain-worker.openbrain.workers.dev
VITE_AUTH_TOKEN=<from Apple Notes>
```

**Step 4 — Run the app**

```bash
cd ~/OpenBrain/apps/desktop
npm run tauri:dev
```

First run will compile Rust dependencies — takes 2–5 minutes. Be patient. A native macOS window titled "OpenBrain" should open.

**Step 5 — Verify connectivity (THIS IS THE KEY CHECK)**

Look at the desktop app window:

- ✅ If the file list shows `.md` files (these are the files Amit synced from his Windows machine's `BrainDemo` vault) → CORS + auth + Worker are all working from this Mac. Success.
- ❌ If you see `TypeError: Failed to fetch` → the CORS fix didn't take effect or `.env.local` is wrong. Check that the auth token matches what's in `friday-cron/.env`.
- ❌ If you see `Loading vault...` forever → check the dev console output in the terminal for errors.

**Step 6 — Verify search works**

In the app, type a word from any of the synced files into the search bar at the top. You should see results within a second.

**Step 7 — IMPORTANT: do NOT click "Choose vault folder" on this Mac**

Doing so would start a second sync source pushing the same files to R2 from a different path, creating duplicates. Setting up dual-machine sync is a separate task — for this verification, just confirm you can browse and search the Windows-synced vault from the Mac.

---

## Final report

When done, report back with:

1. Part A result: did `tail` show clean `Starting run` lines?
2. Part B result: does the file list show files? Does search work?
3. Anything unexpected.
