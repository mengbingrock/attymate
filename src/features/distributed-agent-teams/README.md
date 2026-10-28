# Distributed Agent Teams

Manager-side integration for Relay-backed workers and remote assignments.

- `contracts/` is browser-safe and defines the IPC DTO surface.
- `core/` contains transport-independent use cases and ports.
- `main/` owns Relay HTTP access and Electron IPC registration.
- `preload/` exposes the validated renderer API.

The Relay is configured with `AGENT_TEAMS_RELAY_URL` and defaults to
`http://127.0.0.1:43170`. This feature never exposes the Relay URL as an arbitrary
renderer-supplied network target.

Packaged Workers now connect through a local gateway: `localWorkerCli.js` starts an authenticated
loopback WebSocket relay, then loads the existing Worker CLI with that local URL. The gateway
forwards frames to the configured AWS relay over TLS. It keeps no separate team database or
leases, and disconnects the Worker on upstream failure so durable message replay stays with the
existing Worker/AWS protocol. This gateway serves Worker WebSockets only; manager HTTP requests
still use the configured Relay URL above. The Codex App Server retains its own local socket.

Interactive Codex runtime sessions additionally require
`AGENT_TEAMS_RELAY_MANAGER_TOKEN` in Electron and `AGENT_TEAMS_RELAY_WORKER_TOKEN` in the Relay and
Workers. Session capability tokens stay inside the main-process Relay adapter. The renderer sees
only lease-scoped DTOs and validated controls.

Directly started Workers default to a private Worker-owned `CODEX_HOME` at
`<data-dir>/codex-home`. Authenticate that home explicitly with
`CODEX_HOME=<data-dir>/codex-home codex login`; the Worker never imports credentials or personal
plugin/MCP configuration automatically. `--codex-home` selects an explicit private directory, and
the Worker `status`/`diagnose` commands expose its non-secret state.

The [teammate installer](../../../packages/agent-teams-worker/installer/README.md) supports both
an installed stock Codex binary with its built-in App Server and the existing bundled fork.
`build-installer.sh --runtime fork` is still the default. `--runtime stock` produces a Worker-only
artifact. Stock can run a supervisor-owned server or connect to an operator-started server with
`--server-ownership external --app-server-mode shared-daemon --app-server-connect-only` and an
explicit `--app-server-socket` and matching `--codex-home`. External mode never starts or stops
that server. Both clients use `agents --remote <endpoint>` to attach to the same local server.

Both runtime kinds can run at once and participate in a mixed team. They have separate node
identities, data directories, endpoints, services, runtime state, and control-MCP registrations.
Stock reuses the existing Codex home and cached login by default, without starting another
sign-in. Separate homes remain opt-in; SQLite state, logs and GUI profiles stay per installation,
while configuration and rollout history in the selected home are shared. New registration names include the installation ID, while legacy fork names remain valid.
The Worker persists runtime choice, observed executable identity, process ownership, and compatibility
checks; it does not silently switch kinds or overwrite another installation. Direct-source launches
can still use private stdio or a shared local daemon.

The CLI defaults stock to `mcp-inbox` delivery and keeps legacy fork/direct-source launches on
`inline`; either mode can be selected explicitly with `--message-delivery-mode`. Inbox wake-ups
carry message identifiers, and authenticated MCP supplies message bodies and local processing
receipts. The same MCP tools handle peer messages, lead aliases, scoped support/review requests,
and assignment progress/results. Requests never grant execution authority or approve reviews.
Shared-daemon assignment bridges read their current session token from the installation-owned
`runtime-session.token` file so Worker restarts do not require reusing another installation's token.

Current mixed-runtime native evidence covers **darwin-arm64**: both lead orientations, both delivery
modes, actual model-driven MCP reads/receipts, Worker restart recovery, and stock/fork terminal client
attachment. Other platform pairs need their own native signoff; Windows contract/fixture tests do
not establish native Windows compatibility. macOS stock installs open the desktop app by default; terminal attachment is optional.
The tested startup pair is stock `0.165.0` and ChatGPT desktop `26.1016.51333`. A2A is an optional future external-agent gateway, with no role
in either installation's required execution or messaging path.

The implementation follows
[the distributed Codex runtime ADR](../../../docs/team-management/distributed-codex-runtime.md).

## Team directory and join portal

The Relay can publish named teams, each protected by its own join token, and serve a public join page
at `/join/` when started with `--public-url`. A join token is shown once, stored only as a digest, and
also works as a Worker credential that binds the Worker to that one team. Managers create, rotate, and
remove tokens through `/v2/team-directory`. The desktop app does not manage the directory yet. See
`docs/team-management/distributed-codex-runtime.md`.

## Leaderless teams

A team can run with members only. The Relay stores a per-team coordination mode (`led` by default,
or `leaderless`) behind `GET`/`PUT /v2/teams/<team>/settings`. Leaderless teams never get a lead:
every join is a member join, auto-join works without a lead, and the Relay's startup lead
promotion skips them. The team detail header shows the mode as a **Led** or **Leaderless** badge
with a switch button (**Make leaderless** / **Assign a lead**). Its confirmation names the lead who
will be demoted or the earliest member who will be promoted, and sends the revision it was shown, so
a concurrent change fails with 409 instead of being overwritten. **Reconnect lead** is hidden for
leaderless teams. The topology poll reads `GET /v2/team-settings`; a Relay built before settings
existed answers 404, which the adapter treats as "every team is led". See
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
