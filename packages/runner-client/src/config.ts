import os from "node:os";
import path from "node:path";

export interface RunnerClientConfig {
  /** Control-plane base URL, e.g. wss://paperclip.attymate.com or ws://127.0.0.1:3100 */
  serverUrl: string;
  /** Company this runner serves. */
  companyId: string;
  /** Static pairing token (slice 1). Must match the server's PAPERCLIP_RUNNER_TOKEN. */
  token: string;
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
 * Build config from environment. Slice 1 keeps this dead simple (env only); a
 * later slice adds a pairing flow + on-disk device identity.
 *
 *   PAPERCLIP_RUNNER_SERVER_URL   ws(s)://host[:port]  (required)
 *   PAPERCLIP_RUNNER_COMPANY_ID   uuid                 (required)
 *   PAPERCLIP_RUNNER_TOKEN        shared secret        (required)
 *   PAPERCLIP_RUNNER_ID           label                (optional)
 *   PAPERCLIP_RUNNER_WORKSPACES   abs path             (optional)
 */
export function loadRunnerClientConfig(env: NodeJS.ProcessEnv = process.env): RunnerClientConfig {
  const serverUrl = required("PAPERCLIP_RUNNER_SERVER_URL", env.PAPERCLIP_RUNNER_SERVER_URL);
  const companyId = required("PAPERCLIP_RUNNER_COMPANY_ID", env.PAPERCLIP_RUNNER_COMPANY_ID);
  const token = required("PAPERCLIP_RUNNER_TOKEN", env.PAPERCLIP_RUNNER_TOKEN);
  const runnerId = env.PAPERCLIP_RUNNER_ID?.trim() || os.hostname();
  const workspacesRoot =
    env.PAPERCLIP_RUNNER_WORKSPACES?.trim() ||
    path.join(os.homedir(), ".paperclip", "runner", "workspaces");
  return { serverUrl, companyId, token, runnerId, workspacesRoot };
}
