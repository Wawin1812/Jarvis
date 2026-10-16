#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

if [[ -f .run/backend.pid ]] && kill -0 "$(cat .run/backend.pid)" 2>/dev/null; then
  kill "$(cat .run/backend.pid)"
  echo "Backend stopped."
fi
rm -f .run/backend.pid
# Free the model's memory too.
ollama stop "$(cat backend/.env backend/.env.local 2>/dev/null | grep '^OLLAMA_MODEL=' | head -1 | cut -d= -f2)" >/dev/null 2>&1 || true
