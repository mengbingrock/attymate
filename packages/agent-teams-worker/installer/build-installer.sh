#!/usr/bin/env bash
# Build a single-file teammate installer with the compiled worker bundle embedded.
# Usage: build-installer.sh --bundle-dir DIR --relay ws://host:port/v2/worker-stream --token T --team UUID --out FILE
set -euo pipefail
BUNDLE=""; RELAY=""; TOKEN=""; TEAM=""; OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --bundle-dir) BUNDLE="$2"; shift 2 ;; --relay) RELAY="$2"; shift 2 ;; --token) TOKEN="$2"; shift 2 ;;
    --team) TEAM="$2"; shift 2 ;; --out) OUT="$2"; shift 2 ;; *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[ -s "$BUNDLE/cli.js" ] && [ -s "$BUNDLE/controlMcpCli.js" ] && [ -s "$BUNDLE/runtimeMcpCli.js" ] || { echo "bundle dir must contain cli.js, controlMcpCli.js, runtimeMcpCli.js" >&2; exit 2; }
[ -n "$RELAY" ] && [ -n "$TOKEN" ] && [ -n "$TEAM" ] && [ -n "$OUT" ] || { echo "--relay, --token, --team, --out are required" >&2; exit 2; }
[ -d "$BUNDLE/codex-runtime" ] || { echo "Stage the fork with stage-codex-runtime.mjs before building the installer" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
umask 077
sed -e "s|__RELAY_URL__|$RELAY|" -e "s|__WORKER_TOKEN__|$TOKEN|" -e "s|__TEAM_ID__|$TEAM|" "$HERE/install-template.sh" >"$OUT"
set -- cli.js controlMcpCli.js runtimeMcpCli.js codex-runtime
[ ! -f "$BUNDLE/desktopBridgeCli.js" ] || set -- "$@" desktopBridgeCli.js
tar -czf - -C "$BUNDLE" "$@" | base64 >>"$OUT"
chmod 700 "$OUT"
echo "built $OUT ($(du -h "$OUT" | cut -f1)); it contains the relay worker token, share it only with teammates"
