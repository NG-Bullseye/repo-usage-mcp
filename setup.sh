#!/usr/bin/env bash
# Build the repo-usage-mcp server. Run once after cloning and after pulling changes.
set -euo pipefail
cd "$(dirname "$0")"

echo "Installing dependencies..."
npm install

echo "Building..."
npm run build

echo
echo "Done. dist/index.js is built."
echo "Register once with Claude Code:"
echo "  claude mcp add repo-usage -s user -- node \"\$PWD/dist/index.js\""
