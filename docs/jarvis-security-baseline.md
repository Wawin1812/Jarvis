# JARVIS Security Baseline

This document defines the security boundary for the local-first desktop assistant planned for this repository. It is a design constraint, not a claim that the system is bug-free.

## Security goals

- Keep screen, microphone, files, memory, and credentials local by default.
- Make every privileged capability explicit, narrow, revocable, and auditable.
- Treat model output, webpages, documents, screenshots, plugins, and external agents as untrusted input.
- Prevent a compromised or manipulated agent from gaining broader access by chaining through another agent.
- Fail closed when policy, identity, or authorization cannot be verified.

## Non-goals for the first release

- Fully autonomous operation with unrestricted shell access.
- Hidden or continuous screen capture.
- Automatic sending of messages, purchases, submissions, or other external actions.
- Loading arbitrary community plugins into the trusted process.
- Sending raw private screen or document data to third-party coding agents or cloud models.

## Trust boundaries

```text
User-facing UI
    | narrow, validated IPC only
Desktop host / local authority
    | policy decision required for every tool call
Policy + approval gateway
    | least-privilege capability tokens
Sandboxed specialist agents
    | typed tool contracts
Restricted OS/API adapters
```

The UI must never receive unrestricted filesystem, process, network, or native APIs. The model must never call native APIs directly. Agents may propose tool calls; only the policy gateway may authorize them.

## Initial capability classes

| Capability | Default | Approval |
| --- | --- | --- |
| Chat with no private context | Allowed | None |
| Read a user-selected screen region | Off | Per capture |
| Search an approved folder | Off | Folder grant |
| Write inside a task workspace | Off | Per task |
| Run a process | Off | Per command and sandbox |
| Browser read-only access | Off | Per session |
| Browser interaction | Off | Per action or workflow |
| Send external communication | Denied | Explicit final confirmation |
| Delete or overwrite data | Denied | Explicit confirmation plus preview |
| Persistent memory write | Denied | User approval |

## Mandatory controls

### Local data

- Bind the local authority to loopback only.
- Use authenticated, short-lived local sessions between the UI and authority.
- Store secrets in the operating system credential store, never in prompts, source files, or ordinary logs.
- Encrypt persistent memory and audit records at rest where the platform supports it.
- Redact credentials, tokens, payment data, and private messages before model submission or logging.

### Screen and microphone

- Capture only after an explicit user action or an enabled, visible mode.
- Show a persistent capture indicator while capture is active.
- Support region capture before full-screen capture.
- Stop capture when the task ends, the app loses authorization, or the user presses the emergency stop.
- Never use screen capture as an implicit source of context.
- Send a screen frame only after a separate, visible user action; never upload the live preview automatically.
- Do not persist screen frames or raw microphone audio in the backend.

### Tools and agents

- Use allowlisted, typed tools rather than arbitrary function execution.
- Give each specialist agent a separate identity, capability set, and task budget.
- Deny network access to code-execution sandboxes unless a policy explicitly grants an allowlisted destination.
- Confine writes to an approved workspace or temporary directory.
- Do not allow agents to modify policy, permissions, audit logs, or their own instructions.
- Require a human-reviewed diff before merging generated code.

### Untrusted content and prompt injection

- Keep user instructions separate from evidence collected from screens, webpages, files, emails, and model outputs.
- Label evidence as data, never as instructions.
- Do not let content retrieved by an agent grant new permissions.
- Require confirmation when untrusted content attempts to trigger an action.
- Bound every observe/act/verify loop by time, steps, tokens, and tool calls.

### Supply chain

- Pin dependency versions and generate a software bill of materials.
- Review licenses and maintenance status before adopting an external project.
- Prefer small, vendored or audited adapters over broad plugin marketplaces.
- Verify release signatures or checksums where available.
- Run dependency, secret, static-analysis, and license checks in CI.

Production startup must fail closed when encrypted audit persistence is not configured. An in-memory audit log is permitted only for local development and tests.

## Verification standard

Before enabling screen control, voice, browser automation, or external integrations, the project must have:

1. Unit tests for policy decisions and capability boundaries.
2. Integration tests proving the UI cannot bypass the authority.
3. Fuzz tests for tool arguments, IPC messages, file paths, URLs, and serialized memory.
4. Adversarial tests for prompt injection through webpages, documents, screenshots, and email.
5. Negative tests proving denied actions remain denied under agent retries and delegation.
6. Dependency and container/sandbox scanning.
7. A manual threat-model review and an independent security review before release.

## Assessment and high-risk contexts

The assistant must not be designed to secretly observe an assessment or provide answers during one. A compliant learning mode can explain user-provided material, run practice questions, and provide accessibility support when permitted. A dedicated assessment mode should disable answer-generation and external-action tools.
