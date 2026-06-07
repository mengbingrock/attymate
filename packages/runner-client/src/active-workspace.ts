// Resolve the user's ACTIVE Workspace folder (runner-client side).
//
// The runner is paired AS THE USER (session cookie). It asks the control plane
// which local folder the user marked active — GET /users/me/workspaces — and runs
// the agent there. The absolute path never leaves this machine: the server only
// stores/returns it to the same user who granted it.
//
// "Active" = the row with the most-recent non-null `activeAt`, else the oldest
// grant (matches the server's getActive precedence), so a single-folder user
// needs zero clicks.

import type { RunnerClientConfig } from "./config.js";

interface UserWorkspaceRow {
  id: string;
  workspacePath: string;
  grantedAt: string;
  updatedAt: string;
  activeAt: string | null;
}

/** ws(s)://host[:port] → http(s)://host[:port] origin for REST calls. */
function httpBaseFromServerUrl(serverUrl: string): string {
  const u = new URL(serverUrl);
  if (u.protocol === "wss:") u.protocol = "https:";
  else if (u.protocol === "ws:") u.protocol = "http:";
  return u.origin;
}

function pickActive(rows: UserWorkspaceRow[]): UserWorkspaceRow | null {
  if (rows.length === 0) return null;
  const marked = rows
    .filter((r) => r.activeAt)
    .sort((a, b) => new Date(b.activeAt as string).getTime() - new Date(a.activeAt as string).getTime());
  if (marked.length > 0) return marked[0];
  // Fall back to the oldest grant.
  return [...rows].sort(
    (a, b) => new Date(a.grantedAt).getTime() - new Date(b.grantedAt).getTime(),
  )[0];
}

/** Exposed for unit testing the precedence logic without a network call. */
export function selectActiveWorkspacePath(rows: UserWorkspaceRow[]): string | null {
  return pickActive(rows)?.workspacePath ?? null;
}

/**
 * Fetch the user's active workspace folder path, or null if none granted / the
 * call fails. Cookie auth only — token (headless) runners have no user and thus
 * no Workspace folder, so they get null here and fall back to the runner root.
 */
export async function resolveActiveWorkspacePath(
  config: RunnerClientConfig,
): Promise<string | null> {
  if (config.auth.mode !== "cookie") return null;
  const base = httpBaseFromServerUrl(config.serverUrl);
  // REST routes are mounted under /api (server app.use("/api", api); UI client
  // uses BASE="/api"). Must match or the request 404s and we wrongly conclude
  // "no active workspace".
  const url = `${base}/api/users/me/workspaces`;
  try {
    const res = await fetch(url, {
      headers: { Cookie: config.auth.cookie, Accept: "application/json" },
    });
    if (!res.ok) {
      // Distinguish a failed lookup from a genuinely-empty workspace list so the
      // "no active workspace" error isn't misattributed (e.g. a 404/401 here).
      // eslint-disable-next-line no-console
      console.warn(`[runner-client] workspace lookup failed: ${res.status} ${url}`);
      return null;
    }
    const rows = (await res.json()) as UserWorkspaceRow[];
    if (!Array.isArray(rows)) return null;
    return selectActiveWorkspacePath(rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[runner-client] workspace lookup error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
