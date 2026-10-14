# JARVIS Architecture Plan

The existing Site Roaster application remains intact. The assistant should begin as a separate local-first subsystem so security-sensitive desktop capabilities do not get mixed into the public website analyzer.

## Proposed components

- `desktop/` — future Tauri or Electron shell, global shortcut, tray/overlay, permission indicators, and emergency stop.
- `authority/` — the only trusted local coordinator; owns sessions, policy, approvals, audit events, and task lifecycle.
- `agents/` — untrusted specialist workers such as frontend, backend, researcher, memory, voice, and screen-analysis agents.
- `tools/` — typed adapters for files, browser, screen capture, speech, calendar, and other integrations.
- `memory/` — encrypted SQLite-backed profile, preferences, approved facts, and task history.
- `security/` — capability tokens, policy decisions, redaction, sandbox launchers, and security tests.

## Agent roles

Agents are separate workers, not separate authorities:

- `coordinator`: decomposes a user-approved goal and dispatches bounded subtasks.
- `frontend-engineer`: works only in an assigned code workspace.
- `backend-engineer`: works only in an assigned code workspace and cannot change policy code.
- `security-reviewer`: read-only review of diffs and test results.
- `memory-librarian`: proposes memory changes; the user approves persistence.
- `screen-interpreter`: receives only an explicitly captured image or region and returns structured observations.
- `voice`: handles speech input/output but has no filesystem or process access.

Every agent receives a minimal context envelope containing its task, allowed tools, budget, and expiration. Agent-to-agent messages are data and cannot extend privileges.

## First implementation slice

The first slice should be non-privileged and testable:

1. Define typed task, tool, approval, and audit-event schemas.
2. Build an in-process policy gateway with deny-by-default decisions.
3. Add a read-only coordinator that can dispatch mock specialist agents.
4. Add an activity timeline showing proposed actions, policy decisions, and results.
5. Add security tests for delegation, expired approvals, malformed arguments, and prompt-injection-shaped evidence.

Only after this slice passes should the project add local model inference or OS integration.

## Implemented foundation

The first slice is now present in `server/src/jarvis/`:

- `contracts.ts` defines tasks, agents, approvals, tool requests, results, and audit events.
- `agentRegistry.ts` prevents duplicate agent identities and rejects unknown agents.
- `toolGateway.ts` is the only path from an agent to a tool; it checks the agent allowlist, approval expiry, capability policy, and handler availability.
- `authority.ts` creates bounded tasks, dispatches registered agents, and records completion/failure events.
- `auditLog.ts` provides an in-memory append-only sink for tests. Persistent encrypted storage is deliberately not enabled yet.

The implementation currently has no model runtime and no operating-system tools. That is intentional: adding those capabilities will happen behind the already-tested gateway.

## Container boundary

The backend can run in Docker and is now configured with a non-root runtime, a read-only root filesystem, dropped Linux capabilities, a no-new-privileges flag, a local-only published port, resource limits, and a named data volume. The container is suitable for the authority, model server, worker, and persistence layers.

The container must not receive host screen, microphone, Accessibility, or keyboard/mouse permissions. The native/browser bridge owns explicit capture and communicates with the authority through the authenticated localhost API.

## Current API surface

- `GET /api/jarvis/status` — authenticated runtime status.
- `POST /api/jarvis/tasks` — authenticated, bounded coordinator task submission.
- `GET /api/jarvis/audit` — authenticated audit event retrieval.
- `POST /api/jarvis/tasks/async` — authenticated background task submission.
- `GET /api/jarvis/tasks` and `GET /api/jarvis/tasks/:id` — bounded in-process task status.
- `POST /api/jarvis/screen` — sends one explicitly captured image to the configured local multimodal model; it is not stored.

All JARVIS routes require `JARVIS_API_TOKEN`; they return `503` when the token is not configured, rather than silently operating without authentication. Only the coordinator agent and the non-privileged `chat` capability are wired in the current runtime.

When `JARVIS_AUDIT_KEY` is configured as a 32-byte hexadecimal key, audit events are encrypted with AES-256-GCM and persisted under `JARVIS_DATA_DIR`. When `OLLAMA_BASE_URL` and `OLLAMA_MODEL` are configured, the coordinator calls the local Ollama-compatible `/api/chat` endpoint with bounded requests and no tool permissions. Without those variables, the backend remains usable as a safe stub.

The backend does not directly control the desktop: browser and native bridges own capture and permissions, while filesystem, browser, process, and external-action tools remain disabled until separately reviewed and added through the policy gateway.

The current async task manager is intentionally in-process and bounded. It is suitable for one local backend instance; a future multi-worker deployment should replace it with a durable queue adapter rather than sharing unbounded memory between workers.

## External project evaluation

The following projects were reviewed as architectural references:

- [Jarvis AI](https://github.com/amanimran786/jarvis-ai) — useful patterns for local-first routing, specialized agents, Seatbelt sandboxing, task worktrees, and verification.
- [Interpreter Workstation](https://github.com/openinterpreter/interpreter-workstation) — useful desktop/renderer separation, read-only access modes, reproducible submodules, and local policy boundaries.
- [open-browser-use](https://github.com/open-browser-use/open-browser-use) — useful browser capability-gating and owner-only local brokering, but browser sessions must be treated as highly privileged.
- [Vox](https://github.com/vox-ai-app/vox) — useful macOS layering ideas: narrow preload IPC, local model hosting, overlay UI, and platform adapters.

These are references only. They are not security attestations, and no dependency should be adopted without license, maintenance, dependency, and source review.
