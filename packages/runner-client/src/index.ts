#!/usr/bin/env node
// Paperclip local execution runner — entry point.
//
// Connects outbound to the control plane and executes agent runs on this
// machine. Configuration is via environment (see config.ts).

import { loadRunnerClientConfig } from "./config.js";
import { startRunnerConnection } from "./connection.js";

/** ws(s)://host[:port] → http(s)://host[:port] (origin only), or null if unparseable. */
function httpBaseFromServerUrl(serverUrl: string): string | null {
  try {
    const u = new URL(serverUrl);
    if (u.protocol === "wss:") u.protocol = "https:";
    else if (u.protocol === "ws:") u.protocol = "http:";
    return u.origin;
  } catch {
    return null;
  }
}

function main() {
  let config;
  try {
    config = loadRunnerClientConfig();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return;
  }

  // Point agent runs at the real control plane. Adapters derive PAPERCLIP_API_URL
  // from process.env via buildPaperclipEnv; on the runner the default would be
  // http://localhost:3100 (nothing listens there). Override with the HTTP base of
  // the control plane we dialed so the agent's API callbacks reach it.
  const apiBase = httpBaseFromServerUrl(config.serverUrl);
  if (apiBase) {
    process.env.PAPERCLIP_RUNTIME_API_URL = apiBase;
    // eslint-disable-next-line no-console
    console.log(`[runner-client] agent API base: ${apiBase}`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `[runner-client] starting runner "${config.runnerId}" for company ${config.companyId}`,
  );
  const conn = startRunnerConnection(config);

  const shutdown = () => {
    // eslint-disable-next-line no-console
    console.log("[runner-client] shutting down");
    conn.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
