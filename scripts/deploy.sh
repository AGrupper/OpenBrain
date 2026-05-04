#!/usr/bin/env bash
# OpenBrain deploy script - run from repo root after completing docs/CLOUD_SETUP.md steps 1-4
set -euo pipefail

echo "==> Deploying OpenBrain Worker..."
cd services/worker
npm install --silent
npm run deploy
cd ../..

echo ""
echo "Worker deployed."
echo ""
echo "Next steps:"
echo "  1. Register Telegram webhook if you are using that optional path (see docs/CLOUD_SETUP.md)"
echo "  2. Start the desktop app: cd apps/desktop && npm run tauri:dev"
echo "  3. Run The Architect jobs (see services/architect-agent/README.md)"
