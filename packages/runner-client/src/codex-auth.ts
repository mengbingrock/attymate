// Reconcile codex auth on the runner with the agent's configured source.
//
// The runner runs the codex CLI on the user's machine. The codex agent config
// has a `useServerCodexAuth` toggle:
//
//   - true  → run as the SAME account as the control plane. The runner pulls the
//             server's auth.json (GET /api/runner/codex-auth) and installs it,
//             backing up the user's own local login once so it can be restored.
//   - false → use the machine's local codex login. If we previously switched to
//             the server's auth, restore the backed-up local. As a convenience,
//             when there is no local login at all we still pull the server's so a
//             fresh machine can run codex without `codex login`.
//
// Trust/safety:
//   - Cookie pairing only (the desktop runner authenticates AS THE USER; the
//     endpoint also checks company membership). Token/headless runners manage
//     their own codex auth and are skipped.
//   - The user's local login is never destroyed — it is backed up and restorable
//     by turning the toggle off.
//   - Best effort: any failure logs and continues.

import {
  readSharedCodexAuthRaw,
  writeServerCodexAuth,
  restoreLocalCodexAuth,
} from "@paperclipai/adapter-codex-local/server";
import type { RunnerClientConfig } from "./config.js";

/** The runner adapterType that uses the codex CLI. */
const CODEX_ADAPTER_TYPE = "codex_local";

/** ws(s)://host[:port] → http(s)://host[:port] origin for REST calls. */
function httpBaseFromServerUrl(serverUrl: string): string {
  const u = new URL(serverUrl);
  if (u.protocol === "wss:") u.protocol = "https:";
  else if (u.protocol === "ws:") u.protocol = "http:";
  return u.origin;
}

/** Fetch the server's codex auth.json, or null when unavailable / not shared. */
async function fetchServerCodexAuth(
  config: RunnerClientConfig,
  log: (chunk: string) => void,
): Promise<string | null> {
  if (config.auth.mode !== "cookie") return null;
  const base = httpBaseFromServerUrl(config.serverUrl);
  const url = `${base}/api/runner/codex-auth?companyId=${encodeURIComponent(config.companyId)}`;
  const res = await fetch(url, {
    headers: { Cookie: config.auth.cookie, Accept: "application/json" },
  });
  if (res.status === 404) {
    log("[runner-client] no codex auth on the control plane to share.\n");
    return null;
  }
  if (!res.ok) {
    log(`[runner-client] codex auth lookup failed: ${res.status}.\n`);
    return null;
  }
  return res.text();
}

/**
 * Reconcile the local codex auth with the agent's configured source before a
 * codex run. No-op for non-codex adapters and token-only runners. Never throws.
 */
export async function ensureCodexAuthProvisioned(
  config: RunnerClientConfig,
  adapterType: string,
  agentConfig: Record<string, unknown>,
  log: (chunk: string) => void,
): Promise<void> {
  if (adapterType !== CODEX_ADAPTER_TYPE) return;
  // The distribution endpoint is cookie-gated (paired AS the user). Headless /
  // token runners own their codex auth, so don't touch it.
  if (config.auth.mode !== "cookie") return;

  const useServerAuth = agentConfig?.useServerCodexAuth === true;

  try {
    if (useServerAuth) {
      const raw = await fetchServerCodexAuth(config, log);
      if (!raw) return; // leave whatever is there; codex surfaces its own error
      const { backedUp } = await writeServerCodexAuth(raw, process.env);
      log(
        backedUp
          ? "[runner-client] using the server's codex auth; your local login was backed up and will be restored if you turn this off.\n"
          : "[runner-client] using the server's codex auth.\n",
      );
      return;
    }

    // Local mode: undo a previous server switch if we made one.
    const { restored } = await restoreLocalCodexAuth(process.env);
    if (restored) {
      log("[runner-client] restored your local codex auth.\n");
      return;
    }

    // Convenience: a fresh machine with no codex login at all gets the server's
    // so codex can run without an interactive `codex login`.
    if (!(await readSharedCodexAuthRaw(process.env))) {
      const raw = await fetchServerCodexAuth(config, log);
      if (!raw) {
        log("[runner-client] no local codex login found; codex will require `codex login`.\n");
        return;
      }
      await writeServerCodexAuth(raw, process.env);
      log("[runner-client] provisioned codex auth from the control plane (no local login found).\n");
    }
  } catch (err) {
    log(
      `[runner-client] codex auth provisioning error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}
