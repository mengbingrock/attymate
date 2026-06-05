import os from "node:os";
import path from "node:path";

/**
 * How the runner authenticates to the control plane:
 *   - cookie: the logged-in user's session cookie (desktop/Electron pairing).
 *     The server resolves the user and checks company membership.
 *   - token: a static shared pairing secret (headless/CI), matched against the
 *     server's PAPERCLIP_RUNNER_TOKEN.
 */
export type RunnerAuth =
  | { mode: "cookie"; cookie: string }
  | { mode: "token"; token: string };

export interface RunnerClientConfig {
  /** Control-plane base URL, e.g. wss://paperclip.attymate.com or ws://127.0.0.1:3100 */
  serverUrl: string;
  /** Company this runner serves. */
  companyId: string;
  /** How this runner authenticates the WS upgrade. */
  auth: RunnerAuth;
  /** Free-form runner identity for server logs. */
  runnerId: string;
  /** Root under which the runner realizes workspaces. */
  workspacesRoot: string;
}

function required(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(`runner-client: missing required env ${name}`);
  }
  return value.trim();
}

/**
 * Build config from environment. Exactly one auth credential is required:
 * a session cookie (preferred, per-user pairing) OR the static token (headless).
 *
 *   PAPERCLIP_RUNNER_SERVER_URL      ws(s)://host[:port]  (required)
 *   PAPERCLIP_RUNNER_COMPANY_ID      uuid                 (required)
 *   PAPERCLIP_RUNNER_SESSION_COOKIE  cookie header        (one of cookie/token)
 *   PAPERCLIP_RUNNER_TOKEN           shared secret        (one of cookie/token)
 *   PAPERCLIP_RUNNER_ID              label                (optional)
 *   PAPERCLIP_RUNNER_WORKSPACES      abs path             (optional)
 */
export function loadRunnerClientConfig(env: NodeJS.ProcessEnv = process.env): RunnerClientConfig {
  const serverUrl = required("PAPERCLIP_RUNNER_SERVER_URL", env.PAPERCLIP_RUNNER_SERVER_URL);
  const companyId = required("PAPERCLIP_RUNNER_COMPANY_ID", env.PAPERCLIP_RUNNER_COMPANY_ID);

  // Cookie takes precedence — it's how the desktop app pairs as the user.
  const cookie = env.PAPERCLIP_RUNNER_SESSION_COOKIE?.trim();
  const token = env.PAPERCLIP_RUNNER_TOKEN?.trim();
  let auth: RunnerAuth;
  if (cookie) {
    auth = { mode: "cookie", cookie };
  } else if (token) {
    auth = { mode: "token", token };
  } else {
    throw new Error(
      "runner-client: set either PAPERCLIP_RUNNER_SESSION_COOKIE or PAPERCLIP_RUNNER_TOKEN",
    );
  }

  const runnerId = env.PAPERCLIP_RUNNER_ID?.trim() || os.hostname();
  const workspacesRoot =
    env.PAPERCLIP_RUNNER_WORKSPACES?.trim() ||
    path.join(os.homedir(), ".paperclip", "runner", "workspaces");
  return { serverUrl, companyId, auth, runnerId, workspacesRoot };
}
