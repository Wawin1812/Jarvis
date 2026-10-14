#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

if [[ ! -f backend/.env ]]; then
  cp backend/.env.example backend/.env
  echo "Created backend/.env from backend/.env.example; set JARVIS_API_TOKEN and JARVIS_AUDIT_KEY before production use."
fi

docker compose up -d --build jarvis-backend
docker compose ps
