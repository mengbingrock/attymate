# Distributed Agent Teams

Manager-side integration for Relay-backed workers and remote assignments.

- `contracts/` is browser-safe and defines the IPC DTO surface.
- `core/` contains transport-independent use cases and ports.
- `main/` owns Relay HTTP access and Electron IPC registration.
- `preload/` exposes the validated renderer API.

The Relay is configured with `AGENT_TEAMS_RELAY_URL` and defaults to
`http://127.0.0.1:43170`. This feature never exposes the Relay URL as an arbitrary
renderer-supplied network target.

Interactive Codex runtime sessions additionally require
`AGENT_TEAMS_RELAY_MANAGER_TOKEN` in Electron and `AGENT_TEAMS_RELAY_WORKER_TOKEN` in the Relay and
Workers. Session capability tokens stay inside the main-process Relay adapter. The renderer sees
only lease-scoped DTOs and validated controls.

Every Worker runs Codex App Server with a private Worker-owned `CODEX_HOME` (by default
`<data-dir>/codex-home`). Authenticate that home explicitly with
`CODEX_HOME=<data-dir>/codex-home codex login`; the Worker never imports credentials or personal
plugin/MCP configuration automatically. `--codex-home` selects an explicit private directory, and
the Worker `status`/`diagnose` commands expose its non-secret state.

By default each session is a private `codex app-server` child on stdio pipes that nothing else can
attach to. `--app-server-mode shared-daemon` instead starts (idempotently) and connects to the
managed App Server daemon of that same Codex home (`codex app-server daemon start`). Threads then
live in the daemon, so the home's owner can open the running or finished threads later with
`CODEX_HOME=<data-dir>/codex-home codex agents` (live agent command center) or
`CODEX_HOME=<data-dir>/codex-home codex resume`. `--app-server-socket <path>` overrides the control
socket. The runtime thread's feature disables (`apps`, `plugins`, `remote_plugin = false`) travel in each
thread's own `thread/start` config, so the home's `config.toml` and its daemon are left as they
are; the per-thread inventory check still fails closed if a capability leaks. That makes it safe to
point `--codex-home` at the owner's existing `~/.codex`: team threads then appear directly in that
person's `codex agents` and Codex app, next to their own work. Writing the disables into the home
config remains available as an opt-in (`writeHomeFeatureDisables`) for daemons that ignore
thread-level overrides.
Because the daemon keeps a thread's MCP bridge process alive across turns, the Worker in this mode
also mirrors the current runtime session token into `<data-dir>/runtime-session.token` (mode 0600)
and the bridge reads it on every call, so token rotations after a Worker restart stay transparent.

The implementation follows
[the distributed Codex runtime ADR](../../../docs/team-management/distributed-codex-runtime.md).

## Leaderless teams

A team can run with members only. The Relay stores a per-team coordination mode (`led` by default,
or `leaderless`) behind `GET`/`PUT /v2/teams/<team>/settings`. Leaderless teams never get a lead:
every join is a member join, auto-join works without a lead, and the Relay's startup lead
promotion skips them. Desktop's **Reconnect lead** reports that such a team has no active lead. See
`docs/team-management/distributed-codex-runtime.md` for the API and switching rules.

## Persistent local leads

Desktop recovery is deliberately limited to lead installations provisioned under:

```text
~/.local/share/agent-teams/distributed-leads/<team UUID>/
├── lead.json
├── start-worker.sh
├── worker.pid
├── config/worker.env
├── data/
├── workspace/
└── worker/
```

`lead.json` binds the directory to the Relay team and lead node IDs. The **Reconnect lead** button
sends only the team ID over IPC. Electron main verifies that the Relay's active lead matches this
manifest, refuses symbolic links or a non-executable launcher, avoids a duplicate live PID, and
starts the fixed launcher detached. Relay and Worker credentials remain in the protected
`config/worker.env`; they are never returned to the renderer.
