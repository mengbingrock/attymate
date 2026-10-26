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
By default it starts Codex with `apps`, `plugins`, and `remote_plugin` disabled;
the assignment-scoped Worker MCP bridge is then the only permitted external tool server.
An owner can opt in to selected existing connections with `--connections-config`.
This changes connection access without changing the Relay, Worker, or lease architecture.

### Owner local access and native UI tools

The owner may supply `--local-access-config /private/local-access.json` with
`{"mode":"personal","writableRoots":[]}`. Personal mode tells the runtime to use
local tools for owner-requested files, rather than claiming the working directory
is the only readable location. The installed Codex 0.145.0 sandbox schema has no
per-directory read allowlist: reads follow Codex and operating system access.
`writableRoots` adds write locations, not read limits. Other writes and network
access retain the normal on-request approval flow. The Relay's workspace file
broker continues to reject paths outside its workspace.

`--computer-use` loads the official unified native MCP launch specification
already installed in this device's selected Codex home. That component exposes
Browser Use (including available Chrome/Edge backends) and native Computer Use.
The Worker does not copy another desktop chat's access identity, change vendor
code, install an alternative automation backend, or bypass native permissions.
Installed tools still require a live functional test on each device.

Teams approval responses travel through the existing `approval.resolve` control.
The adapter supplies the expected thread, turn and App Server generation; the
Worker verifies these and the pending RPC before responding. Permission replies
copy only requested permission fields and grant them for the current turn.
All three running components must use the updated protocol before this flow is
tested: an old Relay rejects the additional approval context fields.

### Existing plugins, apps, and MCP connections

Pass an owner-only JSON file (0600) to the Worker:

```sh
agent-teams-worker start --connections-config /private/worker-connections.json ...
```

```json
{
  "mcpServers": {
    "clio": {
      "enabledTools": ["auth_status", "list_matters", "list_tasks"],
      "env": { "READ_ONLY": "true" },
      "readOnly": true,
      "approvalMode": "approve"
    }
  },
  "apps": {
    "connector-id-from-app-list": {
      "enabledTools": ["get_profile", "search"],
      "readOnly": true,
      "expectedEmail": "owner@example.com"
    }
  },
  "plugins": {}
}
```

MCP server definitions and credentials come from the selected Codex home. The
file selects existing servers; it does not create incomplete server definitions
or copy credentials. Omit `enabledTools` to permit all tools on a selected MCP
server. Its approval mode defaults to `prompt`; `readOnly: true` verifies tool
annotations before execution begins. Provider authorization still controls which
records the account can read.

Apps use IDs from App Server `app/list` and tool names from `app/read`.
Only named app tools are enabled. Apps default to read-only, and `expectedEmail`
can check the connected account using provider metadata. Unselected apps remain
disabled. Hosted apps can be enabled independently of packaged plugins.

Packaged plugins are selected by their configured `name@marketplace` key:

```json
{
  "plugins": {
    "notes@local": {
      "mcpServers": {
        "notes": {
          "inventoryName": "plugin_notes_notes",
          "enabledTools": ["search"]
        }
      }
    }
  }
}
```

Use the server's actual name from `mcpServerStatus/list` as `inventoryName`.
Declare every bundled server the plugin needs. Plugin tool approvals default to
`prompt`; plugin hooks retain Codex's own trust requirements. Unselected configured
plugins and MCP servers remain disabled. The owner-control server cannot be
selected or substituted for the assignment-scoped runtime bridge.

Connection checks run on starts and continuations. The hosted app MCP status
endpoint returns a raw catalog that includes disabled tools, so the Worker checks
selected tools and account metadata there and checks effective callable app IDs
separately with `app/installed`. Task and runtime controls remain lease-bound.
Direct provider tools use their configured account and approval rules rather than
the runtime bridge's assignment token. Use read tools for context-only deployments;
external mutations require their own authorization.

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

### Local lead recovery

A manager-hosted distributed lead keeps its stable identity, Worker SQLite state, isolated
`CODEX_HOME`, approved workspace, Worker bundle, and protected environment beneath
`~/.local/share/agent-teams/distributed-leads/<team UUID>/`. This avoids depending on temporary
directories that disappear at reboot.

The desktop **Reconnect lead** action is a narrow recovery operation, not a general process
launcher. The renderer supplies only a validated team UUID. Electron main reads the active lead
membership from the authenticated Relay, requires a matching local `lead.json`, and launches only
that team's fixed `start-worker.sh`. A connected Relay worker or a live PID is never duplicated.
This is manual recovery after the manager host or Worker stops; it does not elect a new lead or
start remote members.

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

To let an authenticated Worker advertise itself and join an existing team without a lead-side
command, configure its target team:

```text
AGENT_TEAMS_AUTO_JOIN_TEAM_ID=<team UUID>
```

The equivalent CLI option is `--auto-join-team <team UUID>`. Auto-discovery only enrolls the
Worker as a `member`; it cannot claim leadership, and a led team must already have an active lead.
A leaderless team (below) accepts auto-join immediately.
The Relay derives a stable enrollment identity from the team and Worker node, so reconnects are
idempotent. If the lead or the operator removes that membership, its tombstone suppresses automatic
re-enrollment on later reconnects. Re-enrollment then requires an explicit join or a deliberately
new Worker node identity.

### Team directory and public join portal

A Relay can publish a team directory with a public join page. Each directory team has a name, a
description, a `listed` flag, and its own **join token** (`atj_…`, 256 random bits). The Relay stores
only a SHA-256 digest of each token and returns the plaintext exactly once, when it is created or
rotated.

Manager routes (manager token required):

| Route | Purpose |
|---|---|
| `GET /v2/team-directory` | All directory entries with their coordination mode; never tokens |
| `POST /v2/team-directory` | Create an entry (`name`, optional `description`, `listed`, `coordination`, `teamId`); returns `joinToken` |
| `PATCH /v2/team-directory/<team>` | Rename, re-describe, or list/unlist |
| `POST /v2/team-directory/<team>/join-token` | Rotate the token; Workers connected with the old token are disconnected |
| `DELETE /v2/team-directory/<team>` | Remove the entry and revoke its token |

A join token is also a Worker credential. A Worker that connects with it instead of the Relay-wide
Worker token is bound to that team: its hello must advertise that team as `autoJoinTeamId` (close
code 4010 otherwise), and the manager cannot enroll it into any other team. Rotation or removal closes
its session with code 4011. The Worker needs no change; the token goes in
`AGENT_TEAMS_RELAY_WORKER_TOKEN` or `--relay-token` as before.

The public portal is off unless the Relay gets `--public-url`. With it, the Relay serves:

- `/join/`: a static page that lists listed teams with a token (name, description, mode, member and
  online counts) and, after a correct token, offers the installer download and clone-and-run steps;
- `GET /join/api/teams`: the same listing as JSON;
- `POST /join/api/teams/<team>/verify` and `POST /join/api/teams/<team>/installer` with `{"token"}`.
  Wrong tokens and unknown teams get the same 401. The installer is rendered like
  `installer/build-installer.sh`, with the public Worker stream URL and the team's token baked in.

```bash
relay --public-url https://relay.example/next \
  --join-installer-template packages/agent-teams-worker/installer/install-template.sh \
  --join-worker-bundle worker-bundle.tgz \
  --join-repo-url https://github.com/<org>/<repo>.git --join-repo-branch <branch>
```

`worker-bundle.tgz` holds `cli.js`, `controlMcpCli.js`, and `runtimeMcpCli.js` at its root. Without
the installer options the page offers only the clone steps; without the repository options only the
installer. Pages are sent with a strict Content-Security-Policy (no third-party origins, no inline
script), `nosniff`, and `no-referrer`, and render manager-supplied text with `textContent` only.

Native fork distributions can publish separate archives with repeated
`--join-worker-bundle-platform <platform>=<archive>` flags instead of `--join-worker-bundle`.
Archives also contain the corresponding `codex-runtime/<platform>/` package and manifest; see
[the teammate installer](../../packages/agent-teams-worker/installer/README.md). The public catalog
and successful token check expose `installerPlatforms`. The download POST then takes
`{"token":"<team token>","platform":"darwin-x64"}`. Only configured builds are offered, and a
missing or unavailable platform returns 400. Legacy single-archive downloads remain supported.
Installer responses stream base64 in bounded chunks with an exact content length, avoiding a
second complete in-memory copy of a native runtime's shell installer.

The published page is [relay.truegrit.dev/next/join/](https://relay.truegrit.dev/next/join/);
the domain root redirects there. It offers the tested Intel Mac and Linux x64 builds. Users pick
a team, enter their join token and member name, select their computer, download and run the
installer, then copy the displayed `attach.sh` command to open the customized local Codex client.
The installer reuses the current `$CODEX_HOME` or `~/.codex` sign-in by default without copying
credentials. `--private-codex-home` selects a separate sign-in. The fork's state database is kept
under the installation with a process-local `sqlite_home` override, and its socket is separate
from the user's normal daemon. Existing home permissions and configuration are not changed.
Apple Silicon is offered only after a native `darwin-arm64` archive has been staged and configured.

To publish the portal while existing teams keep running, use the same compiled CLI in a separate
process with `--installer-portal-only --upstream-url http://127.0.0.1:43181`. This process needs no
manager or Worker credential: it delegates listing, token checks, token revocation, and rate limits
to the existing Relay's public join API. Its upstream must be a loopback HTTP origin. It owns no
team database or execution leases. Route `/next/join/*` to it while stripping `/next`; leave other
`/next/*` traffic, including Worker WebSockets, on the original Relay. Caddy can hot-reload this
route without restarting that Relay. The current service is `agent-teams-installer-portal.service`
on loopback port 43182; its immutable release directory is under
`~/agent-teams-next/releases/web-installers-20261026T015209Z/`. Deployment and archive-download
verification reports are stored there. Do not use the original Relay's SQLite database in a second
Relay process to publish installer changes.

Failed token checks are rate limited per client (20 per 10 minutes by default). Behind a loopback
reverse proxy the Relay trusts only the proxy's own, last `X-Forwarded-For` entry. When the proxy
itself sees every client as loopback (for example a TCP pass-through in front of it without the PROXY
protocol), clients cannot be told apart and share one larger budget (300 per 10 minutes), so a single
client cannot lock others out quickly. The join tokens' entropy, not the limiter, is the real defense.

### Leaderless teams

A team is `led` by default: the Relay keeps exactly one active lead, makes the first joiner the
lead, and on every start promotes the oldest member of any team that lost its lead. Declare a team
`leaderless` to run it with members only:

```bash
curl -X PUT "$RELAY/v2/teams/<team UUID>/settings" \
  -H "authorization: Bearer $AGENT_TEAMS_RELAY_MANAGER_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"coordination":"leaderless","expectedRevision":0}'
```

The team does not need any members yet. `GET /v2/teams/<team UUID>/settings` reads the mode (revision
`0` means the team was never configured) and `GET /v2/team-settings` lists every configured team.
`expectedRevision` is optional and guards against concurrent changes with a 409.

In a leaderless team:

- every join, explicit or auto-join, is a `member` join, and a `role: "lead"` join fails with 409
  `RELAY_TEAM_LEADERLESS`;
- the startup lead promotion skips the team;
- members coordinate peer to peer with `message_send` and the task tools; the default assignment text
  tells them there is no lead;
- no agent can add or remove other members, because those tools are lead-only. The operator does it
  through `POST` and `DELETE /v2/teams/<team UUID>/members`, and a member can still leave itself.

Switching a led team to `leaderless` demotes its lead to member. Switching back to `led` promotes the
oldest active member. In both cases the Relay fences that membership's current execution lease and
offers it a fresh assignment in its new role, so its runtime tool profile matches. Connected Workers
that advertise the team auto-join as soon as it becomes leaderless. The mode is Relay state only and
does not appear in membership snapshots, so Workers built before this change keep working.

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

### Attachable App Server (shared daemon mode)

`--app-server-mode private-stdio` (default) spawns one private `codex app-server` child per
session; only the Worker holds that JSON-RPC connection. `--app-server-mode shared-daemon` makes
the Worker run `CODEX_HOME=<home> codex app-server daemon start` (idempotent) and speak the same
App Server protocol over the daemon's Unix control socket (`<home>/app-server-control/
app-server-control.sock`, resolved through its short temp-directory symlink because Unix socket
paths are length-limited). Per-thread configuration such as the assignment-scoped runtime MCP
server is still passed in `thread/start`, so the security invariants above are unchanged.

What changes is ownership of the threads: they now live in the home's managed daemon, so the
owner can attach to the very same threads from the stock Codex CLI:

```bash
CODEX_HOME="$WORKER_DATA_DIR/codex-home" codex agents    # live view of running threads
CODEX_HOME="$WORKER_DATA_DIR/codex-home" codex resume    # reopen or continue a thread
```

Trade-offs: feature disables are passed per thread (`features` in the `thread/start` config), so
the home's `config.toml` and daemon stay untouched and the home may be the owner's own `~/.codex`;
the per-thread inventory check still fails closed with `Codex runtime MCP inventory leaked
capabilities: ...` if a capability leaks. Anything the owner types into an attached thread is
visible to the Worker's next turn on that thread.

Token lifecycle differs from private-stdio runtimes: the daemon keeps the thread's bridge process
alive, so the assignment's session token is no longer revoked when a turn completes, and the Worker
mirrors the current token into `<data-dir>/runtime-session.token` (owner-only) which the bridge reads
per call via `AGENT_TEAMS_RUNTIME_SESSION_TOKEN_FILE`. Authorization still requires the token to be
bound to the binding's current turn and to an unexpired lease. `--app-server-socket <path>` overrides
the control socket when the daemon was provisioned elsewhere.

Use `--codex-home <path>` to select a different dedicated home. `status` reports the resolved path;
`diagnose` reports whether it is private and whether an `auth.json` artifact is present without
reading or printing credential contents. `setup` is separate: it manages the control MCP entry in
the operator-facing Codex configuration, while the isolated home is used only by distributed App
Server execution.


## Desktop team chats

The relay join portal now also drives membership-scoped desktop chats. This extension stays in
the existing distributed protocol/relay/worker packages; the standalone portal remains separate
from the Electron feature facade. `desktopChat.ts` owns wire validation, `RelayDesktopChats`
owns paired-device routing and durable message delivery, and `DesktopChatService` owns local
binding policy, persistence, and App Server operations.

A private local pairing code is hashed in the Worker hello. `POST /join/api/desktop` authenticates
that code, lists only the paired node's active memberships, and dispatches validated `context`,
`open`, `attach`, or `default` commands over its existing authenticated Worker connection.
The public directory does not expose node identifiers or pairing hashes. The standalone installer
portal forwards these operations to the core relay, which remains the membership authority.

Bindings persist in `desktop-chats.sqlite` with a separate credential per chat. The tools exposed
under `agent-teams-runtime` are `runtime_context`, `team_membership_list`, `message_send`, and
`message_list`. They use membership scope, never a fabricated task/lease. Task progress and result
submission remain in the existing leased-assignment MCP profile. Every invocation checks current
membership, and the bridge fails closed while disconnected. Role changes are read from the latest
membership snapshot rather than a stale credential payload.

`desktopTransport.ts` attaches the selected configuration on desktop `thread/start` and
`thread/resume`, using the existing fork API. A new default applies only to new chats. Other
connections, including direct CLI connections, do not inherit this desktop default. Per-chat
credentials are independent of the assignment supervisor's rotating token file. Fresh chats record
a developer context item via `thread/inject_items` so legacy history is durable before desktop
resume, without fabricating a user turn or model response.

Membership messages are validated at the relay against the authenticated sender node and both
active memberships. Both ends persist messages; reconnect retries use stable message IDs.
Incoming messages enter the most recently created bound chat for that membership when it is idle.
The model is told not to acknowledge acknowledgements. If there is no desktop chat, a completed
active assignment can receive the message using its existing supervisor. Replies from leased
assignments use the original message route and are diverted to a selected desktop chat locally.
Delivery is at least once across a crash between submitting a turn and recording its receipt;
the injected message includes its ID for duplicate recognition. It does not promise exactly-once
model execution.

Verification: `desktopTeamChats.test.ts`, `desktopTransport.test.ts`, and `joinPortal.test.ts` cover
binding persistence, scoped tools, revoked/cross-team access, paired routing, acknowledgements,
text framing, default selection, and the UI flow. `scripts/smoke/desktop-team-chat.ts` is an opt-in
live echo and Worker-restart test against an explicitly supplied daemon; it creates only isolated
test teams/workspaces and never copies login credentials.

The macOS installer supervisor raises its soft file-descriptor limit to at least 4096 when
permitted. Persistent chat MCP subprocesses keep pipes open, so launchd's default limit of 256
can otherwise prevent later chats from initializing their required tools.

Live verification on the Intel Mac covered member-to-lead echo and reply, Worker restart with the
same chat credential, new-chat default selection, desktop resume, and the deployed portal opening
a visible chat that successfully called `runtime_context`. Both published macOS x64 and Linux x64
installer payloads were downloaded and checksum-verified. Linux desktop launch is not supported;
the Linux package was verified as a downloadable runtime, not through a GUI smoke test.
