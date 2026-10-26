# Teammate installer

`build-installer.sh` produces one self-contained shell file with the compiled worker bundle embedded
and the team's relay URL, worker token and team ID baked in. A new teammate runs:

```bash
bash agent-teams-mate-<team>.sh   # optional: --label NAME --dir DIR --codex-home DIR --existing-codex-home --device-auth --no-service
```

Requirements on the teammate machine: Codex CLI installed, and network reach to the relay.

Each member gets its **own Codex home** (`<dir>/codex-home`, or `--codex-home DIR`) and signs in to
it once during the install: in the browser at a local terminal, or with a device code over SSH or with
`--device-auth`. The Worker then starts a private Codex App Server (`--app-server-mode private-stdio`)
for every assignment the Relay grants. The member never shares a login with the person's everyday
Codex or the ChatGPT app. A shared login breaks after a while, because its refresh token is single-use:
whichever process refreshes first invalidates the copies the others hold. For the same reason the
installer signs in again rather than copying another home's `auth.json`.

`--existing-codex-home` restores the earlier behavior: the member uses `$CODEX_HOME` or `~/.codex` and
its managed daemon, so team threads appear in that person's `codex agents`. Use it only on machines
where no other Codex client signs in to that home. Node 24 is used if present, otherwise a private copy is downloaded into
the install directory. On macOS the worker is registered as a launchd agent (KeepAlive), on Linux as
a systemd user unit; `--no-service` runs it with `nohup` instead.

Build:

```bash
packages/agent-teams-worker/installer/build-installer.sh \
  --bundle-dir <dir with cli.js controlMcpCli.js runtimeMcpCli.js> \
  --relay ws://<lead-host>:43180/v2/worker-stream --token <worker token> --team <team UUID> \
  --out agent-teams-mate-<team>.sh
```

The output embeds the worker token; distribute it only to teammates.
