#!/usr/bin/env bash
# OpenBrain deploy script — run from repo root after completing SETUP.md steps 1-4
set -euo pipefail

echo "==> Deploying OpenBrain Worker..."
cd services/worker
npm install --silent
npm run deploy
cd ../..

echo ""
echo "✅ Worker deployed!"
echo ""
echo "Next steps:"
echo "  1. Register Telegram webhook (see infra/SETUP.md Step 6)"
echo "  2. Start the desktop app: cd apps/desktop && npm run tauri:dev"
echo "  3. Add Friday's cron (see services/friday-cron/README.md)"
