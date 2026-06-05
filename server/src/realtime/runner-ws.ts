// Local Execution Runner WebSocket — server side (slice 1).
//
// A runner-client process on the user's machine dials OUTBOUND to the control
// plane at /api/runner/ws and authenticates with a static pairing token
// (slice 1; Ed25519 device identity is a later slice). The server tracks one
// runner connection per company (latest wins) and the `runner_gateway` adapter
// calls `dispatchRun(companyId, spec, handlers)` to ship a run to it and stream
// results back.
//
// Unlike the local-bridge (per-user, single req/res, 30s cap), this channel is
// per-company and built for ONE long-running operation per message id: run.start
// out, many run.event in, terminated by run.result / run.failed. There is no
// fixed RPC timeout — lifetime is tied to the run.
//
// Protocol: see @paperclipai/adapter-utils/runner-protocol (shared with client).

import type { IncomingMessage, Server as HttpServer } from "node:http";
import { createRequire } from "node:module";
import type { Duplex } from "node:stream";
import type { DeploymentMode } from "@paperclipai/shared";
import {
  RUNNER_WS_PATH,
  RUNNER_AUTH_HEADER,
  RUNNER_COMPANY_HEADER,
  RUNNER_PROTOCOL_VERSION,
  parseRunnerFrame,
  type RunnerExecutionSpec,
  type RunEventFrame,
  type RunResultFrame,
  type RunFailedFrame,
} from "@paperclipai/adapter-utils/runner-protocol";
import type { AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { logger } from "../middleware/logger.js";

interface WsSocket {
  readyState: number;
  ping(): void;
  send(data: string): void;
  terminate(): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: Buffer) => void): void;
  on(event: "pong", listener: () => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

interface WsServer {
  clients: Set<WsSocket>;
  on(event: "connection", listener: (socket: WsSocket, req: IncomingMessage) => void): void;
  on(event: "close", listener: () => void): void;
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (ws: WsSocket) => void,
  ): void;
  emit(event: "connection", ws: WsSocket, req: IncomingMessage): boolean;
}

const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require("ws") as {
  WebSocket: { OPEN: number };
  WebSocketServer: new (opts: { noServer: boolean }) => WsServer;
};

const PING_INTERVAL_MS = 30_000;

/** Callbacks the `runner_gateway` adapter supplies to receive streamed output. */
export interface RunDispatchHandlers {
  onEvent: (event: RunEventFrame["event"], seq: number) => void | Promise<void>;
}

interface InflightRun {
  resolve: (result: AdapterExecutionResult) => void;
  reject: (err: Error) => void;
  handlers: RunDispatchHandlers;
}

interface RunnerRegistryEntry {
  socket: WsSocket;
  companyId: string;
  runnerId: string;
  connectedAt: Date;
  /** Runs dispatched to this runner, keyed by run id (correlation id). */
  inflight: Map<string, InflightRun>;
}

// One entry per company. A new connection from the same company replaces the
// prior one (latest wins); inflight runs on the replaced socket are rejected.
const registry = new Map<string, RunnerRegistryEntry>();

function readHeader(req: IncomingMessage, name: string): string | null {
  const raw = req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return typeof raw === "string" ? raw : null;
}

function rejectUpgrade(socket: Duplex, statusLine: string, message: string) {
  const safe = message.replace(/[\r\n]+/g, " ").trim();
  socket.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${safe}`);
  socket.destroy();
}

/**
 * Slice-1 auth: a single static pairing token shared between the control plane
 * (env PAPERCLIP_RUNNER_TOKEN) and the runner-client. Returns the company id
 * the runner is pairing for, or null to reject. A later slice replaces this
 * with per-device Ed25519 identity + a paired-devices table.
 */
function authorizeRunnerUpgrade(
  req: IncomingMessage,
  opts: { deploymentMode: DeploymentMode },
): { companyId: string } | null {
  // The runner channel requires an identified deployment, mirroring the
  // local-bridge constraint. local_trusted has no per-company external runners.
  if (opts.deploymentMode !== "authenticated") return null;
  const expected = process.env.PAPERCLIP_RUNNER_TOKEN;
  if (!expected) {
    logger.warn("runner-ws: PAPERCLIP_RUNNER_TOKEN not set; refusing runner upgrades");
    return null;
  }
  const presented = readHeader(req, RUNNER_AUTH_HEADER);
  if (!presented || presented !== expected) return null;
  const companyId = readHeader(req, RUNNER_COMPANY_HEADER);
  if (!companyId) return null;
  return { companyId };
}

/** True when a runner is connected and ready for the given company. */
export function isRunnerOnline(companyId: string): boolean {
  const entry = registry.get(companyId);
  return !!entry && entry.socket.readyState === WebSocket.OPEN;
}

/**
 * Dispatch a run to the company's connected runner. Streams run.event frames to
 * `handlers.onEvent` and resolves with the AdapterExecutionResult on run.result
 * (rejects on run.failed or disconnect). No fixed timeout — the caller (the
 * adapter) owns lifetime, which lets long agent runs complete.
 */
export function dispatchRun(
  companyId: string,
  spec: RunnerExecutionSpec,
  handlers: RunDispatchHandlers,
): Promise<AdapterExecutionResult> {
  const entry = registry.get(companyId);
  if (!entry || entry.socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("No local execution runner is connected for this company."));
  }
  const id = spec.runId;
  return new Promise<AdapterExecutionResult>((resolve, reject) => {
    entry.inflight.set(id, { resolve, reject, handlers });
    try {
      entry.socket.send(JSON.stringify({ type: "run.start", id, spec }));
    } catch (err) {
      entry.inflight.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export function setupRunnerWebSocketServer(
  server: HttpServer,
  opts: { deploymentMode: DeploymentMode },
) {
  const wss = new WebSocketServer({ noServer: true });
  const aliveByClient = new Map<WsSocket, boolean>();

  const pingInterval = setInterval(() => {
    for (const socket of wss.clients) {
      if (!aliveByClient.get(socket)) {
        socket.terminate();
        continue;
      }
      aliveByClient.set(socket, false);
      socket.ping();
    }
  }, PING_INTERVAL_MS);

  wss.on("connection", (socket: WsSocket, req: IncomingMessage) => {
    const companyId = (req as IncomingMessage & { paperclipRunnerCompanyId?: string })
      .paperclipRunnerCompanyId;
    if (!companyId) {
      socket.close(1008, "missing company context");
      return;
    }

    // Replace any prior runner for this company, rejecting its inflight runs.
    const prior = registry.get(companyId);
    if (prior) {
      for (const run of prior.inflight.values()) {
        run.reject(new Error("Runner replaced by a newer connection."));
      }
      prior.inflight.clear();
      try {
        prior.socket.close(1000, "replaced by newer connection");
      } catch {
        // best-effort
      }
    }

    const entry: RunnerRegistryEntry = {
      socket,
      companyId,
      runnerId: "unknown",
      connectedAt: new Date(),
      inflight: new Map(),
    };
    registry.set(companyId, entry);
    aliveByClient.set(socket, true);
    logger.info({ companyId }, "runner-ws: runner connected");

    socket.on("pong", () => {
      aliveByClient.set(socket, true);
    });

    socket.on("message", (data: Buffer) => {
      const frame = parseRunnerFrame(data.toString("utf-8"));
      if (!frame) return;

      if (frame.type === "runner.hello") {
        entry.runnerId = frame.runnerId || "unknown";
        if (frame.protocolVersion !== RUNNER_PROTOCOL_VERSION) {
          logger.warn(
            { companyId, client: frame.protocolVersion, server: RUNNER_PROTOCOL_VERSION },
            "runner-ws: protocol version mismatch",
          );
        }
        return;
      }
      if (frame.type === "runner.ping") return;

      // The remaining client frames all carry a run id.
      const runFrame = frame as RunEventFrame | RunResultFrame | RunFailedFrame;
      const inflight = entry.inflight.get(runFrame.id);
      if (!inflight) return;

      if (runFrame.type === "run.event") {
        void Promise.resolve(inflight.handlers.onEvent(runFrame.event, runFrame.seq)).catch(
          (err) => logger.warn({ err, companyId }, "runner-ws: onEvent handler threw"),
        );
        return;
      }
      if (runFrame.type === "run.result") {
        entry.inflight.delete(runFrame.id);
        inflight.resolve(runFrame.result);
        return;
      }
      if (runFrame.type === "run.failed") {
        entry.inflight.delete(runFrame.id);
        inflight.reject(
          Object.assign(new Error(runFrame.errorMessage || "runner failed"), {
            code: runFrame.errorCode,
          }),
        );
        return;
      }
    });

    socket.on("close", () => {
      aliveByClient.delete(socket);
      const current = registry.get(companyId);
      if (current?.socket === socket) {
        for (const run of current.inflight.values()) {
          run.reject(new Error("Local execution runner disconnected."));
        }
        registry.delete(companyId);
        logger.info({ companyId }, "runner-ws: runner disconnected");
      }
    });

    socket.on("error", (err: Error) => {
      logger.warn({ err, companyId }, "runner-ws: socket error");
    });
  });

  wss.on("close", () => {
    clearInterval(pingInterval);
  });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url) return;
    const url = new URL(req.url, "http://localhost");
    // Only handle our path; let other upgrade listeners see non-matching paths.
    if (url.pathname !== RUNNER_WS_PATH) return;

    const authed = authorizeRunnerUpgrade(req, opts);
    if (!authed) {
      rejectUpgrade(socket, "401 Unauthorized", "runner pairing token required");
      return;
    }
    (req as IncomingMessage & { paperclipRunnerCompanyId?: string }).paperclipRunnerCompanyId =
      authed.companyId;
    wss.handleUpgrade(req, socket, head, (ws: WsSocket) => {
      wss.emit("connection", ws, req);
    });
  });

  return wss;
}
