# JARVIS

Local-first personal assistant with a policy-controlled backend and native desktop clients.

## Current state

- `backend/` — authenticated authority API, encrypted audit storage, bounded task manager, and Ollama-compatible text/vision adapter.
- `desktop-macos/` — AppKit shell with Keychain token storage, explicit voice and ScreenCaptureKit capture.
- `client/` — browser fallback UI for authenticated commands and explicit screen capture.

## Start the local stack

```bash
export JARVIS_API_TOKEN="$(openssl rand -hex 32)"
export JARVIS_AUDIT_KEY="$(openssl rand -hex 32)"
./scripts/start-jarvis.sh
```

Open `http://127.0.0.1:5173/` and use the JARVIS panel. Configure `OLLAMA_MODEL` with a local multimodal model to enable screen analysis.

## Security boundary

The backend does not receive host screen, microphone, keyboard, mouse, or filesystem permissions. Clients capture only after a visible user action. Screen frames are sent only when the user requests analysis and are not persisted by the backend. Privileged tools remain disabled until separately reviewed and added through the policy gateway.

