#!/usr/bin/env bash
# Lightweight native start: backend as a Node process (no Docker VM), UI via Vite.
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

[[ -f backend/.env ]] || cp backend/.env.example backend/.env
[[ -d node_modules ]] || npm install

# Fill blank secrets once; existing values are never overwritten.
for key in JARVIS_API_TOKEN JARVIS_AUDIT_KEY; do
  if grep -qE "^${key}=$" backend/.env; then
    sed -i.bak "s|^${key}=$|${key}=$(openssl rand -hex 32)|" backend/.env && rm -f backend/.env.bak
    echo "Generated ${key} in backend/.env"
  fi
done
sed -i.bak 's|^JARVIS_REQUIRE_PERSISTENT_AUDIT=.*|JARVIS_REQUIRE_PERSISTENT_AUDIT=true|' backend/.env && rm -f backend/.env.bak
grep -q '^JARVIS_FILES_ROOT=' backend/.env || echo 'JARVIS_FILES_ROOT=../workspace' >> backend/.env
mkdir -p workspace

if ! curl -fsS -m 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "Warning: Ollama is not reachable on 127.0.0.1:11434 (try: brew services start ollama)." >&2
fi

npm run build:backend >/dev/null
mkdir -p .run
if [[ -f .run/backend.pid ]] && kill -0 "$(cat .run/backend.pid)" 2>/dev/null; then
  kill "$(cat .run/backend.pid)"; sleep 1
fi
(cd backend && exec nohup node dist/index.js > "$repo_dir/.run/backend.log" 2>&1) &
echo $! > .run/backend.pid
sleep 1
echo "Backend started (pid $(cat .run/backend.pid), log .run/backend.log)"
echo "API token: $(grep '^JARVIS_API_TOKEN=' backend/.env | cut -d= -f2)"
echo "UI: http://127.0.0.1:5173/  (Ctrl+C stops the UI; ./scripts/stop-jarvis.sh stops the backend)"
exec npm run dev --workspace=client -- --host 127.0.0.1
