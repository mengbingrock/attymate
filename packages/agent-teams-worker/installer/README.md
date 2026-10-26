# Teammate installer

The installer deploys a local forked Codex package, its customized App Server, and the Worker.
The included terminal client and Worker connect to the same Unix socket. By default they use the
existing login in `$CODEX_HOME`, or `~/.codex` if that variable is unset. The fork's socket and
SQLite state are private to the installation; the user's personal server is not restarted.

```bash
bash agent-teams-mate-<team>.sh   # optional: --label NAME --dir DIR --codex-home DIR --private-codex-home --device-auth --no-service
bash ~/.local/share/agent-teams/mate-<team-prefix>/bin/attach.sh
```

Requirements: macOS or Linux, network reach to the relay, and a fork package for that OS/CPU in
the installer. Node 24 is used if available; otherwise a private copy is downloaded.

An existing sign-in is reused directly from the selected Codex home. Authentication is never
copied into another home. If no sign-in exists, the installer guides login in the browser or with
`--device-auth`. Use `--private-codex-home` for a separate sign-in at `<dir>/codex-home`, or
`--codex-home DIR` to choose a specific home. Existing directories must have mode 0700; their
permissions and `config.toml` are not rewritten. `--existing-codex-home` remains a compatibility
alias for the default behavior.

The supervisor starts the bundled fork with `app-server --listen unix://PATH`, waits for its socket,
then starts the Worker with `--app-server-mode shared-daemon --app-server-connect-only` and that
explicit socket. The Worker cannot start or adopt a stock daemon. `attach.sh` uses the bundled
client's `agents --remote unix://PATH` against the same endpoint. Both processes receive a
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

Supported targets: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`. Repeat staging for each
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

On macOS, use `bash <install-dir>/bin/desktop.sh` to open an installed Codex desktop app against
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
Apple Silicon (`darwin-arm64`) packaging is supported by staging; a native fork build must be
provided separately before distributing to that platform.

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
