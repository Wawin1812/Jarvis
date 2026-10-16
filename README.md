# JARVIS

Local-first personal assistant with a policy-controlled backend and native desktop clients.

## Current state

- `backend/` — authenticated authority API, encrypted audit log, bounded task manager, and an Ollama-compatible text/vision adapter.
  - Agents: `coordinator` plus the specialists `frontend-engineer`, `backend-engineer` and `security-reviewer`. The coordinator can delegate one level deep.
  - Tools: chat and read-only `files.read`, limited to the `workspace/` folder. Every file read needs a human approval (approve or deny in the UI, or `POST /api/jarvis/approvals/:id`).
- `client/` — browser UI: agent picker, approval prompts, explicit screen capture and voice.
- `desktop-macos/` — AppKit shell with Keychain token storage. It does not show approval prompts yet.

## Run it

```bash
brew install ollama && brew services start ollama && ollama pull gemma3:1b
./scripts/start-jarvis.sh      # backend on :3002 + UI on :5173
./scripts/stop-jarvis.sh
```

The script generates the API token and audit key in `backend/.env` and prints the token. Put files you want Jarvis to read in `workspace/`.

This runs the backend as a plain Node process. Docker (`docker compose up -d --build`) is optional; on an 8 GB Mac, Docker Desktop's VM plus a model causes heavy swapping.

## Models and limits

Ollama runs locally: there are no tokens, quotas or API fees, only your RAM, disk and CPU/GPU time. The context window is bounded by the model.

| Model | Size | Notes |
| --- | --- | --- |
| `gemma3:1b` (default) | 0.8 GB | Safe on 8 GB; weak at following tool-use instructions |
| `gemma3:4b` | 3.4 GB | Reliable file reads and image input; needs about 6 GB free, so quit other apps first |

Change `OLLAMA_MODEL` in `backend/.env` and rerun the start script.

## Security boundary

The backend has no host screen, microphone, keyboard, mouse or filesystem permissions beyond the read-only `workspace/` folder, and each read is approved individually. Clients capture only after a visible user action. Screen frames are not persisted. Write, process, browser and external-send tools remain disabled.
