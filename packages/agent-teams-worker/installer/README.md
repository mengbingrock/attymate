# Teammate installer

`build-installer.sh` produces one self-contained shell file with the compiled worker bundle embedded
and the team's relay URL, worker token and team ID baked in. A new teammate runs:

```bash
bash agent-teams-mate-<team>.sh            # optional: --label NAME --dir DIR --codex-home DIR --no-service
```

Requirements on the teammate machine: Codex CLI installed and logged in (its existing home,
`$CODEX_HOME` or `~/.codex`, is used; team threads show up in that person's `codex agents`), and
network reach to the relay. Node 24 is used if present, otherwise a private copy is downloaded into
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
