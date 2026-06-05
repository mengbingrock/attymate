// runner-client WebSocket connection (outbound, with reconnect).
//
// Dials the control plane at RUNNER_WS_PATH, authenticates with the static
// pairing token + company headers (slice 1), announces itself with runner.hello,
// then handles run.start frames by invoking executeRun and streaming
// run.event/run.result back. Reconnects with exponential backoff on drop.

import { createRequire } from "node:module";
import {
  RUNNER_AUTH_HEADER,
  RUNNER_COMPANY_HEADER,
  RUNNER_WS_PATH,
  RUNNER_PROTOCOL_VERSION,
  parseRunnerFrame,
  type RunnerClientFrame,
  type RunStartFrame,
} from "@paperclipai/adapter-utils/runner-protocol";
import type { RunnerClientConfig } from "./config.js";
import { executeRun } from "./execute-run.js";

const require = createRequire(import.meta.url);
const WebSocket = require("ws") as new (
  url: string,
  opts?: { headers?: Record<string, string> },
) => RunnerSocket;

interface RunnerSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "open", listener: () => void): void;
  on(event: "message", listener: (data: Buffer) => void): void;
  on(event: "close", listener: (code: number, reason: Buffer) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

function buildWsUrl(serverUrl: string): string {
  // Normalize http(s) → ws(s); accept ws(s) as-is.
  const u = new URL(serverUrl);
  if (u.protocol === "http:") u.protocol = "ws:";
  else if (u.protocol === "https:") u.protocol = "wss:";
  u.pathname = RUNNER_WS_PATH;
  u.search = "";
  return u.toString();
}

export function startRunnerConnection(config: RunnerClientConfig): { stop: () => void } {
  let socket: RunnerSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;
  const wsUrl = buildWsUrl(config.serverUrl);

  function log(msg: string, extra?: Record<string, unknown>) {
    const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
    // eslint-disable-next-line no-console
    console.log(`[runner-client] ${msg}${suffix}`);
  }

  function scheduleReconnect() {
    if (stopped) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
    attempt += 1;
    log(`reconnecting in ${delay}ms`);
    reconnectTimer = setTimeout(connect, delay);
  }

  function send(socketRef: RunnerSocket, frame: RunnerClientFrame) {
    try {
      socketRef.send(JSON.stringify(frame));
    } catch (err) {
      log("send failed", { err: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleRunStart(socketRef: RunnerSocket, frame: RunStartFrame) {
    const { id, spec } = frame;
    let seq = 0;
    try {
      const result = await executeRun(
        spec,
        {
          emit: (event) => {
            send(socketRef, { type: "run.event", id, seq: seq++, event });
          },
        },
        { workspacesRoot: config.workspacesRoot },
      );
      send(socketRef, { type: "run.result", id, result });
    } catch (err) {
      send(socketRef, {
        type: "run.failed",
        id,
        errorCode: "runner_execute_failed",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function connect() {
    if (stopped) return;
    log(`connecting to ${wsUrl}`, {
      companyId: config.companyId,
      runnerId: config.runnerId,
      auth: config.auth.mode,
    });
    const headers: Record<string, string> = {
      [RUNNER_COMPANY_HEADER]: config.companyId,
    };
    if (config.auth.mode === "cookie") {
      headers.Cookie = config.auth.cookie;
    } else {
      headers[RUNNER_AUTH_HEADER] = config.auth.token;
    }
    const ws = new WebSocket(wsUrl, { headers });
    socket = ws;

    ws.on("open", () => {
      attempt = 0;
      log("connected");
      send(ws, {
        type: "runner.hello",
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        companyId: config.companyId,
        runnerId: config.runnerId,
      });
    });

    ws.on("message", (data: Buffer) => {
      const frame = parseRunnerFrame(data.toString("utf-8"));
      if (!frame) return;
      if (frame.type === "run.start") {
        void handleRunStart(ws, frame);
      } else if (frame.type === "runner.ping") {
        send(ws, { type: "runner.ping" });
      }
      // run.cancel handling is a later slice (needs in-flight process tracking).
    });

    ws.on("close", (code: number) => {
      log("disconnected", { code });
      if (socket === ws) socket = null;
      scheduleReconnect();
    });

    ws.on("error", (err: Error) => {
      log("socket error", { err: err.message });
      // 'close' will follow and trigger reconnect.
    });
  }

  connect();

  return {
    stop: () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        socket?.close(1000, "runner shutting down");
      } catch {
        // best-effort
      }
    },
  };
}
