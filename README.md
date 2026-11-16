# JARVIS

Local-first personal assistant with a policy-controlled backend and native desktop clients.

## Current state

- `backend/` — authenticated authority API, encrypted audit log, bounded task manager, and an Ollama-compatible text/vision adapter.
  - Agents: `coordinator` plus the specialists `frontend-engineer`, `backend-engineer`, `security-reviewer` and `researcher`. The coordinator can delegate or dispatch background jobs.
  - Tools, each behind a human approval (approve or deny in the UI, or `POST /api/jarvis/approvals/:id`): `files.read` and `files.write` (limited to `workspace/`), web search and fetch (`JARVIS_WEB`), opening apps and sites (`JARVIS_OPEN`), document search (`JARVIS_KNOWLEDGE`), and approved memory.
- `client/` — browser HUD: chat thread, activity timeline of every tool call and approval, agent picker, memory and document panels, approval cards, voice and explicit screen capture.
- `desktop-macos/` — AppKit shell with Keychain token storage, approvals and voice.

## Run it

```bash
brew install ollama && brew services start ollama && ollama pull gemma3:1b
./scripts/start-jarvis.sh      # backend on :3002 + UI on :5173
./scripts/stop-jarvis.sh
```

The script generates the API token and audit key in `backend/.env` (or `backend/.env.local`; both are git-ignored) and prints the token. Put files you want Jarvis to read in `workspace/`.

This runs the backend as a plain Node process. Docker (`docker compose up -d --build`) is optional; on an 8 GB Mac, Docker Desktop's VM plus a model causes heavy swapping.

## Models and limits

Ollama runs locally: there are no tokens, quotas or API fees, only your RAM, disk and CPU/GPU time. The context window is bounded by the model.

| Model | Size | Notes |
| --- | --- | --- |
| `gemma3:1b` (default) | 0.8 GB | Safe on 8 GB; weak at following tool-use instructions |
| `gemma3:4b` | 3.4 GB | Reliable file reads and image input; needs about 6 GB free, so quit other apps first |

Change `OLLAMA_MODEL` in `backend/.env` (or `backend/.env.local`; both are git-ignored) and rerun the start script.

## Document search (RAG)

Ask questions about your own files in plain language, for example “what flight am I on? check my documents”.

```bash
ollama pull nomic-embed-text   # 274 MB embedding model
# in backend/.env.local:
JARVIS_KNOWLEDGE=true
```

Then click **Re-index workspace** in the UI. How it works:

1. Text files in `workspace/` are split into overlapping ~900-character chunks and turned into vectors by `nomic-embed-text`. Secrets such as `.env` and keys, symlinks, `node_modules` and binaries are skipped.
2. Vectors are stored in `backend/data/jarvis/knowledge.json` (git-ignored). Re-indexing only re-embeds files that changed.
3. A question about your documents is embedded the same way, and the closest chunks (cosine similarity of at least 0.55) are added to the prompt. The model answers from those excerpts and names the file.

Each search needs your approval like any other tool, and retrieved text is treated as untrusted data, never as instructions. Use `OLLAMA_EMBED_MODEL` to change the embedding model; the index rebuilds when it changes.

## Security boundary

The backend has no host screen, microphone, keyboard or mouse permissions. Files are limited to the `workspace/` folder, and every file, web, document, open or memory action is approved individually (read-only actions can be trusted for 30 minutes at your choice). Clients capture only after a visible user action, and screen frames are not persisted. Process execution and external sending stay disabled.
