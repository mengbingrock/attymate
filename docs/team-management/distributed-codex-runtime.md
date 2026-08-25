# ADR: Distributed Codex Runtime Sessions

**Status:** Accepted

## Decision

Distributed Workers use the open-source Codex App Server as their only execution authority. The
desktop app never creates a parallel shell or tool executor on the Worker. Instead, it opens a
short-lived Relay capability scoped to the exact team, node, assignment attempt, and lease epoch.

```text
renderer -> validated IPC -> Electron main -> authenticated Relay
         -> Worker outbound WebSocket -> local Codex App Server stdio
```

The Worker projects App Server notifications, approval requests, diffs, and command output into a
bounded ephemeral runtime stream. Controls travel in the other direction over the same Worker-owned
connection. Every control is checked by the Relay and Worker against the current execution lease.

The capability token is random, stored as a SHA-256 digest by the Relay, expires no later than the
lease, and stays in Electron main. It is not returned through preload or renderer contracts.

## OpenAI component boundaries

- **Codex CLI and agent harness:** owns context, compaction, tools, sandboxing, command execution,
  and multi-turn work.
- **Codex App Server:** is the live product integration boundary. The Worker uses its JSON-RPC
  threads, turns, steering, interruption, notifications, approval requests, review, and diff APIs.
- **Codex SDK:** remains optional for noninteractive automation and integration harnesses. It does
  not own an already-running distributed session because doing so would create a competing App
  Server lifecycle.

App Server remains private to the Worker over stdio. The Relay does not expose App Server's
experimental WebSocket listener directly.

Each Worker launches App Server with a dedicated `CODEX_HOME`, defaulting to
`<worker-data-dir>/codex-home`. The Worker creates it with mode `0700`, rejects files, symbolic
links, and pre-existing group/world-accessible directories, and passes the override only to the
App Server child. This keeps the operator's personal plugins, MCP servers, skills, history, and
configuration out of distributed execution. The Worker never copies or rewrites credentials.
It also starts Codex with the stock `apps`, `plugins`, and `remote_plugin` feature surfaces disabled;
the assignment-scoped Worker MCP bridge is the only permitted external tool server.

## Security invariants

- Interactive runtime sessions require both Relay manager and Worker authentication.
- Manager and Worker credentials are separate and compared in constant time.
- Runtime session capabilities are rejected after expiration, lease release, fencing, or identity
  mismatch.
- Workspace paths use forward-slash relative paths, reject traversal and absolute paths, resolve
  within the configured runtime workspace, and reject symbolic-link escapes.
- File writes are size-limited, revision-checked, and atomically renamed.
- Event payloads and replay buffers are bounded. Runtime stream data is not written to the durable
  Relay command or event logs.
- TLS must terminate before the Relay when traffic leaves loopback or a trusted SSH tunnel. Workers
  should use `wss://` and managers `https://` for that deployment.

## Runtime surfaces

The Teams view exposes:

- streamed App Server output and state;
- active-turn steering and interruption;
- command and file-change approval cards;
- uncommitted-change review and streamed diffs;
- workspace-scoped directory listing, text-file read, and optimistic atomic write;
- raw durable Relay diagnostics as a separate disclosure.

Traditional local teams keep their tmux consoles. A distributed console represents the Codex
thread and turn rather than pretending the remote Worker has an app-owned tmux pane.

## Configuration

Generate two independent high-entropy values and provide them through process environment or CLI
arguments:

```text
AGENT_TEAMS_RELAY_MANAGER_TOKEN=<manager secret>
AGENT_TEAMS_RELAY_WORKER_TOKEN=<worker secret>
```

The Relay requires both values together. Electron reads only the manager value. Workers read only
the Worker value. Omitting both preserves diagnostics-only insecure LAN mode and the UI disables
all interactive runtime and filesystem controls.

Authenticate the isolated execution home explicitly once before accepting runtime assignments:

```bash
WORKER_DATA_DIR=/path/to/agent-teams-worker-data
mkdir -p "$WORKER_DATA_DIR/codex-home"
chmod 700 "$WORKER_DATA_DIR/codex-home"
CODEX_HOME="$WORKER_DATA_DIR/codex-home" codex login
pnpm --filter @claude-teams/agent-teams-worker dev start \
  --data-dir "$WORKER_DATA_DIR" \
  --runtime-cwd /path/to/disposable-or-approved-workspace \
  --relay wss://relay.example/v2/worker-stream
```

Use `--codex-home <path>` to select a different dedicated home. `status` reports the resolved path;
`diagnose` reports whether it is private and whether an `auth.json` artifact is present without
reading or printing credential contents. `setup` is separate: it manages the control MCP entry in
the operator-facing Codex configuration, while the isolated home is used only by distributed App
Server execution.
