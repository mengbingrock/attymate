#!/usr/bin/env node
// Paperclip local execution runner — entry point.
//
// Connects outbound to the control plane and executes agent runs on this
// machine. Configuration is via environment (see config.ts).

import { loadRunnerClientConfig } from "./config.js";
import { startRunnerConnection } from "./connection.js";

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
