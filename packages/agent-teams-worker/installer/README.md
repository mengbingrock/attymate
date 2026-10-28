# Teammate installer

The default bundled-runtime installer deploys a local forked Codex package, its customized App
Server, and the Worker. The additive [stock Codex installer](#stock-codex-alongside-the-bundled-runtime)
uses an installed official binary and its built-in App Server. Both paths remain supported and can
run together. The included fork terminal client and Worker connect to the same Unix socket. By default they use the
existing login in `$CODEX_HOME`, or `~/.codex` if that variable is unset. The fork's socket and
SQLite state are private to the installation; the user's personal server is not restarted.

```bash
bash agent-teams-mate-<team>.sh   # optional: --label NAME --dir DIR --codex-home DIR --private-codex-home --device-auth --no-service
bash ~/.local/share/agent-teams/mate-<team-prefix>/bin/attach.sh
```

The Unix fork installer requires macOS or Linux, network reach to the Relay, and a matching fork
package in the installer. Node 24 is used if available; otherwise a private copy is downloaded.

An existing sign-in is reused directly from the selected Codex home. Authentication is never
copied into another home. If no sign-in exists, the installer guides login in the browser or with
`--device-auth`. Use `--private-codex-home` for a separate sign-in at `<dir>/codex-home`, or
`--codex-home DIR` to choose a specific home. Existing directories must have mode 0700; their
permissions are not changed. Setup adds only this installation's owned MCP registration to
`config.toml`, preserving unrelated settings and registrations. `--existing-codex-home` remains a compatibility
alias for the default behavior.

The supervisor starts the bundled fork with `app-server --listen unix://PATH`, waits for its socket,
then starts the Worker with `--app-server-mode shared-daemon --app-server-connect-only` and that
explicit socket. This fork launcher cannot start or adopt a different stock daemon. `attach.sh`
uses the bundled client's `agents --remote unix://PATH` against the same endpoint. Both processes receive a
`sqlite_home` override pointing to `<dir>/codex-state`; the server's logs go to `<dir>/logs`.
This keeps a different fork version from migrating the personal daemon's state database.

On macOS the supervisor runs under launchd; on Linux under systemd user services. `--no-service`
uses a background supervisor. If either child exits, it stops its other child and exits;
launchd/systemd restart the installation. Cleanup targets only its own child processes.
Each installation has its own socket and service identity. Stop it before replacing its runtime;
the installer refuses an existing App Server socket. `bin/status.sh` reports Worker state, and
`logs/app-server.log` holds server output.
The supervisor writes its PID to `data/supervisor.pid` and removes it on shutdown. Socket paths
use the short `/tmp/agent-teams-<uid>/` directory, including on macOS where `TMPDIR` is often too long.

Build the Codex fork for each target first. Each package directory must contain `bin/codex` plus
any supporting resources in their expected locations. Stage each target into the compiled Worker
bundle directory (containing `cli.js`, `controlMcpCli.js`, and `runtimeMcpCli.js`):

```bash
node packages/agent-teams-worker/installer/stage-codex-runtime.mjs \
  --source /path/to/built-fork-package \
  --bundle-dir /path/to/worker-bundle \
  --platform linux-x64 --revision <fork-commit-or-build-id>

packages/agent-teams-worker/installer/build-installer.sh \
  --bundle-dir /path/to/worker-bundle \
  --relay wss://relay.truegrit.dev/next/v2/worker-stream --token <team token> --team <team UUID> \
  --out agent-teams-mate-<team>.sh
```

Packaging targets: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `win32-x64`. Each advertised
runtime/platform pair requires its own native verification. Repeat staging for each
target to include. Existing staged targets are refused to prevent merging builds. The manifest
records a release-supplied revision and every file's SHA-256. Installation verifies all files before
executing the fork, and refuses missing platforms or corruption without a stock fallback.
Checksums detect corruption, not publisher authenticity; use a trusted distribution channel.

For the Relay join portal, provide `--join-installer-template` pointing to this template and
`--join-worker-bundle` pointing to a `.tgz` with the three Worker files and `codex-runtime/` at its
root. Its existing installer endpoint embeds that entire archive.
For separate platform downloads, repeat `--join-worker-bundle-platform darwin-x64=<mac archive>`
and `--join-worker-bundle-platform linux-x64=<linux archive>` instead. Each archive needs only its
own staged platform. The web page offers the available builds after the team token is checked.
The live entry point is [relay.truegrit.dev](https://relay.truegrit.dev/).

The output embeds the team credential; distribute it only to that team's members.

For a fork installation on macOS, use `bash <install-dir>/bin/desktop.sh` to open an installed
Codex desktop app against
the same daemon used by `attach.sh` and the Worker. An optional first argument selects the `.app`
path; discovery also supports Codex in the ChatGPT desktop app. The launcher uses a separate GUI
profile under `<install-dir>/desktop-data`, while the backend keeps the selected existing Codex
home and login. It does not replace the personal daemon or modify the application bundle.

The desktop app's `CODEX_APP_SERVER_WS_URL` override connects through a temporary loopback
WebSocket bridge to the installation's private Unix socket. A random per-launch capability path
protects the bridge. It closes when that desktop process exits. This override is version-dependent;
desktop protocol compatibility must be checked with the installed app version.
The GUI retains its bundled CLI for its version-specific startup and organization-policy checks;
`CODEX_CLI_PATH` is cleared for that GUI process. Its session transport still connects to the fork.

## Stock Codex alongside the bundled runtime

The stock installer uses an installed official Codex executable and its built-in App Server.
The existing bundled-fork installer remains supported. Build either artifact explicitly:

```bash
packages/agent-teams-worker/installer/build-installer.sh \
  --runtime stock --bundle-dir /path/to/worker-bundle \
  --relay wss://relay.example/v2/worker-stream --token <team-token> \
  --team <team-UUID> --out agent-teams-mate-stock.sh
```

The Relay serves stock artifacts separately using `--join-stock-installer-template` together
with `--join-stock-worker-bundle` or repeated
`--join-stock-worker-bundle-platform <platform>=<archive>` options. Windows stock artifacts also
require `--join-stock-windows-installer-template`. Existing `--join-installer-template`,
`--join-windows-installer-template`, and `--join-worker-bundle*` options continue serving the fork.
The portal offers only configured platform/runtime pairs. Its download request selects
`runtime: "stock"` or `runtime: "fork"`; omitted runtime preserves the existing fork download.

`--runtime fork` is the build default and requires a staged `codex-runtime/` archive as before.
A stock artifact contains Worker code without any bundled Codex runtime. The stock installer
accepts `--codex-binary /absolute/path/to/codex`, or resolves `codex` from PATH. It records the
selected path in its launch script and fails if that binary is missing or incompatible.

Stock installs default to `mate-<team-prefix>-stock` and a private `codex-home` requiring its own
normal Codex sign-in. Fork installs keep their previous directory and login behavior. Each new
installation has its own node identity, service, sockets, runtime state, and control-MCP name.
Managed stock installs reject `--existing-codex-home` and an explicit personal Codex home because
shared rollout/session storage has not been verified across runtime versions. A custom dedicated
home can be selected with `--codex-home`; external-server mode accepts the operator's explicit
home and reports that its storage isolation is managed by the operator.
Installing a different runtime kind into an existing directory is rejected; use another `--dir`.
Existing fork directories preserve the legacy MCP registration name on upgrade. New installations
use `agent_teams_control_<installation-id>` so registering another installation cannot replace it.

For a manually started stock App Server, use the same explicit Codex home for both processes:

```bash
# Start the official binary in one terminal after signing into this dedicated home.
CODEX_HOME=/path/to/private-codex-home codex app-server \
  --listen unix:///path/to/private-directory/app-server.sock

# Run the worker-only installer in another terminal.
bash agent-teams-mate-stock.sh --codex-binary /absolute/path/to/codex \
  --server-ownership external --app-server-socket /path/to/private-directory/app-server.sock \
  --codex-home /path/to/private-codex-home --no-service
```

External mode requires an already running Unix socket server and never starts, stops, or removes
that server. The normal managed mode starts a dedicated stock App Server and supervises it with
the Worker. In both cases `bin/attach.sh` connects the selected stock terminal client to that
exact endpoint. `bin/stop.sh` stops this installation; `bin/uninstall.sh` also removes only its
service and control-MCP entry while retaining runtime data and login. Select a Worker-created team
thread; an arbitrary new chat is not enrolled by merely connecting to the server. Stock `bin/desktop.sh` is gated until a desktop/server version
pair has been verified. Existing fork desktop attachment continues to work.

Running directly from source also bypasses the fork installer:

```bash
pnpm --filter @claude-teams/agent-teams-worker dev start \
  --runtime-kind stock --server-ownership external \
  --app-server-mode shared-daemon --app-server-connect-only \
  --app-server-socket /path/to/private-directory/app-server.sock \
  --codex-binary /absolute/path/to/codex --codex-home /path/to/private-codex-home \
  --data-dir /path/to/private-worker-data --runtime-cwd /path/to/disposable-team-workspace \
  --relay wss://relay.example/v2/worker-stream --auto-join-team <team-UUID> \
  --organization-id <stable-organization-UUID> --person-id <stable-person-UUID> \
  --node-id <stable-node-UUID>
```

Set `AGENT_TEAMS_RELAY_WORKER_TOKEN` through the existing protected enrollment mechanism. Keep the
same node/data directory across restarts; two concurrent installations need different node IDs.
The Worker performs stock protocol compatibility checks before accepting assignments.

The CLI defaults stock to `--message-delivery-mode mcp-inbox` and keeps legacy fork/direct-source
launches on `inline`; the descriptor persists this selection across restarts. Either mode can be
selected explicitly. Inbox notifications contain IDs rather than peer-message bodies. The recipient
uses `message_list` or `message_get` to read content and `message_ack` to record a local processed
receipt, without sending another acknowledgement to its peer. Existing inline delivery remains
available for both runtime kinds.

Team MCP supports `message_send` to a membership ID or `recipient: "lead"`, plus scoped
`support_request` and `review_request` with summaries, optional details, task references, and artifact
references. Requests resolve the current roster and do not approve reviews, change task status,
or grant execution authority. A team without a lead requires an explicit recipient. The existing
Relay transport and Worker own delivery and wake-up; A2A is not required.

`message_send` accepts optional `inReplyToMessageId`. The Worker verifies that the referenced
message belongs to the current inbox and that the reply targets its sender. It records
`repliedAt` and `replyMessageId` after the reply enters the durable outbox; this does not mark
the original message processed. Reply metadata travels in a versioned envelope within the
existing message text, preserving compatibility with the Relay wire contract. Inbox reads expose
the decoded body and association. A processing acknowledgement never counts as a reply.

If an App Server accepts a turn but its response is lost, delivery reconciles the persisted
thread before retrying. Outcomes that cannot be established remain uncertain and require
reconciliation; restarting the Worker does not automatically resubmit them.

On Windows the stock template accepts `-CodexBinary`, defaults to a private home and a separate
`-stock` directory, and uses an authenticated loopback WebSocket. External mode additionally
requires `-ServerOwnership external`, `-AppServerSocket ws://127.0.0.1:<port>`, `-CodexHome`, and
`-AppServerTokenFile` pointing to the server capability token. Stock terminal attachment uses
`attach.ps1`; stock GUI attachment remains gated. Publish a platform/runtime pair only after its
native smoke test passes; syntax and fixture checks do not establish native Windows compatibility.

## Mixed runtime native verification

The current dual-runtime native matrix is verified on **darwin-arm64**, using stock Codex `0.165.0`
and the tested fork `0.0.0` artifact. The [native smoke](../../../scripts/smoke/stock-forked-codex.ts)
records both executable hashes and tests both lead orientations, inline and MCP-inbox delivery,
actual model-driven MCP reads and processing receipts, stock/fork Worker restarts, and actual
terminal clients attached alongside other App Server clients. Homes, projects, teams, credentials,
and model responses are disposable local fixtures; no external model provider is needed.
The matrix also verifies native MCP progress, review requests and result candidates, lease fencing,
and rejection of old-thread calls during a successor assignment. See the
[validation record](../../../docs/team-management/stock-fork-validation.md) for exact hashes and limits.

The matrix does not certify other operating systems or architectures. In particular, Windows
contract and installer-fixture checks are not native Windows signoff. Stock GUI attachment remains
gated separately from terminal verification. The historical fork-only verification below applies
to its recorded artifacts and does not certify a new stock platform pair.

## Native Mac verification

The Intel Mac (`darwin-x64`, macOS 15.7.9) reached as `mengbing` through the relay's reverse SSH
listener on port 2222 has a native fork at `~/.agent-teams-codex/bin/codex`. Its source is
`~/WorkSync/Git/TrueGrit/codex`, clean at `a1723eda70a4665f139907f8a0f566417d5f5d70`; all tracked
files match the inspected EC2 source snapshot plus its changes. Only a copy of the prebuilt binary
was stripped and ad-hoc signed for packaging. The packaged binary SHA-256 is
`65cfbbc35cf8d4ed94c9ae4fba54f35254ee882401d408a0346a17c73108fdfc`.

The isolated native smoke verified two simultaneous server clients, installation in a path with
spaces, private Node 24 selection, a Worker connection to a disposable authenticated Relay, and
the bundled client's interactive agent command center over the explicit socket. It used a new
Codex home with an inert test API key and started no model turns. Provider authentication was not
tested. A separate test installed its own launchd service, connected a fresh Worker identity to
`wss://relay.truegrit.dev/next/v2/worker-stream`, and received heartbeat acknowledgements. The test
service, plist, processes, and temporary relay credential were removed afterward.
The native smoke harness is `scripts/smoke/forked-codex-installer.py`; it takes `--root`,
`--node`, and `--revision`, and expects the built package in `<root>/package` plus the compiled
Worker, installer scripts, and a compiled test Relay (`mac-relay-test.mjs`) in `<root>/kit`.
`--existing-login` exercises the selected user's real Codex home without writing fake credentials;
the default smoke uses `--private-codex-home` and an inert test API key. A separate existing-login
smoke on the same Mac used `~/.codex`, detected its ChatGPT account, and completed an ephemeral,
tool-free model turn returning `LOGIN_REUSE_OK`. No credentials were copied. The personal
daemon's version/socket metadata and `config.toml` were unchanged.
Apple Silicon was built in [fork Actions run 40287076765](https://github.com/TrueGrit-AI/codex/actions/runs/40287076765)
at `b8acb4804c5a7e353c67323b1fbb60f6711b266d`. The existing Intel build comes from
[fork Actions run 40268806254](https://github.com/TrueGrit-AI/codex/actions/runs/40268806254)
at `a3799dc38fd180bced3234e567ae75cd56edf956`. Both packages' three binaries were signed locally
with `Developer ID Application: Mengbing Wang (W3X4ZUG72V)`, hardened-runtime entitlements,
and Apple secure timestamps. Signed installer smoke tests passed on the local ARM Mac and remote
Intel Mac using fresh test homes and relays, with zero model turns. The tests covered Worker
connection, the interactive CLI session browser, and desktop transport; they did not render a GUI.
No notarization profile was found in this Mac's login or iCloud keychain, so the manifests record
these builds as signed and not notarized.

## GitHub Actions builds and signing

The public fork's [Native team download builds workflow](https://github.com/TrueGrit-AI/codex/blob/build/native-team-downloads/.github/workflows/fork-native-downloads.yml)
builds the customized App Server, CLI, V8 host, response proxy, and Windows sandbox helpers on native
Apple Silicon and Windows x64 runners. It preserves the tested Guardian configuration fix and
records the exact fork commit, compiler, build profile, Actions run, and file hashes. Its artifacts
are unsigned build inputs; they are not presented as signed releases.

Download a successful run's `codex-fork-darwin-arm64` and `codex-fork-win32-x64` artifacts. The
`Distributed native installer smoke` workflow in this repository takes that fork run ID, builds
the Worker, stages each runtime, and exercises native installers in fresh test directories against
a temporary local relay. It makes no model calls and uses no personal Codex home or user project.

Sign the extracted Mac package on the certificate owner's Mac before staging its final bundle:

```bash
node packages/agent-teams-worker/installer/sign-macos-runtime.mjs \
  /path/to/extracted/package '<Developer ID Application identity>' '<notarytool profile>'
node scripts/build/distributed-worker-bundle.mjs /path/to/worker-kit
node packages/agent-teams-worker/installer/stage-codex-runtime.mjs \
  --source /path/to/extracted/package --bundle-dir /path/to/worker-kit \
  --platform darwin-arm64 --revision <fork-commit>
```

The signing helper verifies Actions hashes, applies Developer ID signatures and the fork's V8
hardened-runtime entitlements, verifies signatures, and regenerates hashes. Supplying a named
notarytool profile submits the binaries to Apple and requires an Accepted result. Without a profile
the build manifest explicitly records `not-submitted`; signing alone does not claim notarization.
The signing private key remains in the owner's keychain. Windows builds do not use an Apple
certificate and currently have no Authenticode signature.

## Native Windows installer

The relay accepts `--join-windows-installer-template <install-windows.ps1>` and
`--join-worker-bundle-platform win32-x64=<archive>`. The archive includes the four compiled Worker
entrypoints, `windows-install.mjs`, and `codex-runtime/win32-x64/` containing `bin/codex.exe` and helpers.
Windows is listed only when both its template and archive are available. The download is a `.ps1`
with a framed payload; the Web UI supplies a command for that downloaded file. Its PowerShell
execution-policy override applies to that one process, without changing the machine's policy.
Payload extraction explicitly uses Windows' `System32/tar.exe`, avoiding Git/MSYS tar's treatment
of a drive letter as a remote hostname. Existing nonempty installation directories are refused.

The installer protects its directory with a current-user/SYSTEM ACL, verifies native file hashes,
reuses `$CODEX_HOME` or the existing user's `.codex`, and creates a private Node 24 copy if needed.
`-PrivateCodexHome` selects a separate login; `-NoService` skips the per-user Startup shortcut.
It uses an authenticated loopback WebSocket because Windows Node cannot connect to the fork's
AF_UNIX transport. The Worker and bundled CLI share that server and its private SQLite home;
the Worker never starts an alternate daemon. Control MCP uses an installation-specific named pipe.

The installation lives at `$env:LOCALAPPDATA/AgentTeams/mate-<team-prefix>`. Its `bin` directory has
`start.ps1`, `stop.ps1`, `status.ps1`, `attach.ps1`, and `desktop.ps1`. The desktop launcher accepts
the installed desktop `.exe` path as an optional argument and preserves the app's bundled policy
reader. Windows can attach chats and select their team from the dashboard; automatic foreground
opening of a specific desktop chat remains macOS-only.

Windows x64 was built in [fork Actions run 40289772370](https://github.com/TrueGrit-AI/codex/actions/runs/40289772370)
at `de2b2f9d58f2b2bf27b69a9d6b369f0daa7d3d12`. The packaged Worker passed
[native installer run 40622425379](https://github.com/mengbingrock/attymate/actions/runs/40622425379):
installation in a path with spaces, reuse of an existing test Codex home, relay enrollment,
two authenticated clients of the shared App Server, rejection of a client without its token,
and device pairing-code creation. No model calls or real user projects were used.

The existing EC2 fork was located at `/data/agent-teams/codex` (also `~/agent-teams/codex`), with
base fork commit `831737cdcdc1d04ccdf6f6eb0b081388a5a2f034` and additional uncommitted changes.
The prebuilt `~/agent-teams/bin/codex` is Linux x64, reports `0.0.0`, and has SHA-256
`541b54c658baec59f1f04b27f50b4ad50be6a8cb9a2294098ae3ce0fb16328c6` as inspected on 2026-10-25.
Do not label that binary as a clean build of the commit: its exact source provenance needs to be
captured before release. The adjacent `codex-code-mode-host` helper may also be needed in the package.


## Select a desktop team from the Web UI

The current installer also includes `desktopBridgeCli.js`. Build and package it alongside
`cli.js`, `controlMcpCli.js`, and `runtimeMcpCli.js`; older bundles retain their original launcher.
The installer registers the owner-control MCP in the selected Codex home and prints a private
device pairing code. Retrieve it later from `<installation>/data/desktop-pairing-code`.

On the relay join page, enter that code under **Your desktop team**. The page lists only this
device's active memberships. **Open team chat** creates a persistent chat, attaches membership
MCP tools, and opens it on the paired Mac. **Use for new desktop chats** applies to new chats
created through this installation's desktop launcher. Existing chats retain their bindings;
**Attach existing chat** accepts an idle chat ID or link. A chat already bound to another team
must be replaced with a new chat rather than silently moved. Clear the default with
**Personal chats by default**. CLI clients connecting directly to the daemon do not inherit the
desktop default; they can resume the already bound team chat.

The pairing code remains in browser memory only. It authorizes control of this installation,
so treat it as a credential. Team join tokens do not authorize controlling another device.
The desktop bridge uses per-chat credentials, retains unrelated personal MCP configuration,
and reapplies the selected team on resume. Restart the desktop launcher after upgrading an
older installation to use the new transport. Linux can create and resume team chats, but the
automatic desktop opener currently supports macOS only.
