// runner-client WebSocket connection (outbound, with reconnect).
//
// Dials the control plane at RUNNER_WS_PATH, authenticates with the static
// pairing token + company headers (slice 1), announces itself with runner.hello,
// then handles run.start frames by invoking executeRun and streaming
// run.event/run.result back. Reconnects with exponential backoff on drop.

import WebSocketImpl from "ws";
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

// Static import so esbuild can inline ws into a self-contained bundle (the
// packaged Electron app forks this with no node_modules alongside it). The cast
// keeps the existing structural RunnerSocket typing.
const WebSocket = WebSocketImpl as unknown as new (
  url: string,
  opts?: { headers?: Record<string, string> },
) => RunnerSocket;

interface RunnerSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  ping(): void;
  terminate(): void;
  on(event: "open", listener: () => void): void;
  on(event: "message", listener: (data: Buffer) => void): void;
  on(event: "close", listener: (code: number, reason: Buffer) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "ping" | "pong", listener: () => void): void;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// Client-side heartbeat. After the machine sleeps and wakes, the TCP connection
// is often half-open: readyState is still OPEN and no 'close' fires, so the
// runner looks connected but the server has already reaped it ("No local
// execution runner is connected"). We actively ping and, if nothing is received
// for HEARTBEAT_TIMEOUT_MS (> 2× the server's 30s ping), terminate the dead
// socket so the normal reconnect/backoff kicks in.
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;

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
  let heartbeatTimer: NodeJS.Timeout | null = null;
  const wsUrl = buildWsUrl(config.serverUrl);

  function clearHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

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
        { workspacesRoot: config.workspacesRoot, config },
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
    let lastActivityAt = Date.now();
    const markActivity = () => {
      lastActivityAt = Date.now();
    };

    ws.on("open", () => {
      attempt = 0;
      lastActivityAt = Date.now();
      log("connected");
      send(ws, {
        type: "runner.hello",
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        companyId: config.companyId,
        runnerId: config.runnerId,
      });
      clearHeartbeat();
      heartbeatTimer = setInterval(() => {
        if (socket !== ws) return;
        if (Date.now() - lastActivityAt > HEARTBEAT_TIMEOUT_MS) {
          log("heartbeat timeout — terminating stale socket");
          try {
            ws.terminate();
          } catch {
            // best-effort; 'close' will follow and trigger reconnect
          }
          return;
        }
        try {
          ws.ping();
        } catch {
          // ignore; staleness check above will catch a dead socket
        }
      }, HEARTBEAT_INTERVAL_MS);
    });

    ws.on("message", (data: Buffer) => {
      markActivity();
      const frame = parseRunnerFrame(data.toString("utf-8"));
      if (!frame) return;
      if (frame.type === "run.start") {
        void handleRunStart(ws, frame);
      } else if (frame.type === "runner.ping") {
        send(ws, { type: "runner.ping" });
      }
      // run.cancel handling is a later slice (needs in-flight process tracking).
    });

    // Any inbound liveness signal (server ws ping or our pong) counts as activity.
    ws.on("ping", markActivity);
    ws.on("pong", markActivity);

    ws.on("close", (code: number) => {
      log("disconnected", { code });
      clearHeartbeat();
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
      clearHeartbeat();
      try {
        socket?.close(1000, "runner shutting down");
      } catch {
        // best-effort
      }
    },
  };
}
