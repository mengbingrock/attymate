// Local bridge WebSocket — server side.
//
// Each AttyMate (Electron) client opens a long-lived WS to
//   wss://paperclip.attymate.com/api/local-bridge/ws
// authenticated via the same session cookie the browser uses. The server
// tracks one connection per user (latest wins). Other server code calls
// `dispatchToUserBridge(userId, op, args)` to send an RPC over that channel
// and await the response.
//
// Protocol (JSON over text frames):
//   Server → Client    { type: "request",  id, op, ...args }
//   Client → Server    { type: "response", id, ok: true,  ...result }
//                  or  { type: "response", id, ok: false, error, code? }
//   Bidirectional      ws.ping() / ws.pong() — handled by the ws library.
//
// F3 deliverable is the channel itself + the dispatch primitive. F4 wires
// the local_read_file agent tool through `dispatchToUserBridge`.

import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import { createRequire } from "node:module";
import type { Duplex } from "node:stream";
import type { Db } from "@paperclipai/db";
import type { DeploymentMode } from "@paperclipai/shared";
import type { BetterAuthSessionResult } from "../auth/better-auth.js";
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

const BRIDGE_PATH = "/api/local-bridge/ws";
const RPC_TIMEOUT_MS = 30_000;
const PING_INTERVAL_MS = 30_000;

interface BridgeRegistryEntry {
  socket: WsSocket;
  userId: string;
  connectedAt: Date;
  pending: Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>;
}

// Module-scoped registry: one entry per user. A new connection from the same
// user replaces (and gracefully closes) the prior entry — last connection wins,
// avoiding the "stale tab" footgun where an old socket lingers.
const registry = new Map<string, BridgeRegistryEntry>();

function headersFromIncomingMessage(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, raw] of Object.entries(req.headers)) {
    if (!raw) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(key, value);
      continue;
    }
    headers.set(key, raw);
  }
  return headers;
}

function rejectUpgrade(socket: Duplex, statusLine: string, message: string) {
  const safe = message.replace(/[\r\n]+/g, " ").trim();
  socket.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${safe}`);
  socket.destroy();
}

async function authorizeBridgeUpgrade(
  req: IncomingMessage,
  opts: {
    deploymentMode: DeploymentMode;
    resolveSessionFromHeaders?: (headers: Headers) => Promise<BetterAuthSessionResult | null>;
  },
): Promise<string | null> {
  if (opts.deploymentMode !== "authenticated" || !opts.resolveSessionFromHeaders) {
    // Bridge requires an identified user; local_trusted mode has no concept of
    // per-user connections so we don't accept bridge upgrades there.
    return null;
  }
  const session = await opts.resolveSessionFromHeaders(headersFromIncomingMessage(req));
  return session?.user?.id ?? null;
}

/**
 * Dispatch an RPC to a user's connected AttyMate bridge. Returns the parsed
 * response payload (whatever the client put under the response message after
 * stripping `type` and `id`). Throws if no bridge is connected for that user,
 * the connection dies mid-flight, or the call times out.
 *
 * Callers (F4 agent tools) should treat "no bridge" as an expected condition
 * the agent can surface to its user, not a server error.
 */
export async function dispatchToUserBridge(
  userId: string,
  op: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const entry = registry.get(userId);
  if (!entry || entry.socket.readyState !== WebSocket.OPEN) {
    throw new Error("AttyMate is not connected for this user.");
  }
  const id = randomUUID();
  const payload = JSON.stringify({ type: "request", id, op, ...args });
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      entry.pending.delete(id);
      reject(new Error(`AttyMate bridge call timed out after ${RPC_TIMEOUT_MS}ms (op=${op}).`));
    }, RPC_TIMEOUT_MS);
    entry.pending.set(id, { resolve, reject, timer });
    try {
      entry.socket.send(payload);
    } catch (err) {
      clearTimeout(timer);
      entry.pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export function isUserBridgeConnected(userId: string): boolean {
  const entry = registry.get(userId);
  return !!entry && entry.socket.readyState === WebSocket.OPEN;
}

export function setupLocalBridgeWebSocketServer(
  server: HttpServer,
  _db: Db,
  opts: {
    deploymentMode: DeploymentMode;
    resolveSessionFromHeaders?: (headers: Headers) => Promise<BetterAuthSessionResult | null>;
  },
) {
  const wss = new WebSocketServer({ noServer: true });
  const aliveByClient = new Map<WsSocket, boolean>();
  const userIdByClient = new Map<WsSocket, string>();

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
    const userId = (req as IncomingMessage & { paperclipBridgeUserId?: string }).paperclipBridgeUserId;
    if (!userId) {
      socket.close(1008, "missing user context");
      return;
    }

    // Replace any prior connection for this user, dropping the stale one.
    const prior = registry.get(userId);
    if (prior) {
      try {
        for (const { reject, timer } of prior.pending.values()) {
          clearTimeout(timer);
          reject(new Error("AttyMate bridge replaced by a newer connection."));
        }
        prior.socket.close(1000, "replaced by newer connection");
      } catch {
        // best-effort
      }
    }

    const entry: BridgeRegistryEntry = {
      socket,
      userId,
      connectedAt: new Date(),
      pending: new Map(),
    };
    registry.set(userId, entry);
    aliveByClient.set(socket, true);
    userIdByClient.set(socket, userId);
    logger.info({ userId }, "local bridge: client connected");

    socket.on("pong", () => {
      aliveByClient.set(socket, true);
    });

    socket.on("message", (data: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString("utf-8"));
      } catch {
        logger.warn({ userId }, "local bridge: client sent non-JSON frame; ignoring");
        return;
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        (parsed as { type?: unknown }).type !== "response"
      ) {
        return;
      }
      const msg = parsed as { type: "response"; id?: unknown; ok?: unknown; error?: unknown };
      const id = typeof msg.id === "string" ? msg.id : null;
      if (!id) return;
      const pending = entry.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      entry.pending.delete(id);
      if (msg.ok === true) {
        const { type: _t, id: _i, ok: _o, ...payload } = msg as Record<string, unknown>;
        pending.resolve(payload);
      } else {
        const errMessage = typeof msg.error === "string" ? msg.error : "bridge call failed";
        pending.reject(new Error(errMessage));
      }
    });

    socket.on("close", () => {
      aliveByClient.delete(socket);
      userIdByClient.delete(socket);
      const current = registry.get(userId);
      if (current?.socket === socket) {
        for (const { reject, timer } of current.pending.values()) {
          clearTimeout(timer);
          reject(new Error("AttyMate bridge disconnected."));
        }
        registry.delete(userId);
        logger.info({ userId }, "local bridge: client disconnected");
      }
    });

    socket.on("error", (err: Error) => {
      logger.warn({ err, userId }, "local bridge: client error");
    });
  });

  wss.on("close", () => {
    clearInterval(pingInterval);
  });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url) return;
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== BRIDGE_PATH) {
      // Not for this WS server. Other upgrade listeners (e.g. live-events-ws)
      // will see the same event. The "tail destroyer" responsibility (closing
      // truly unrouted upgrades) lives in this handler because it's registered
      // last; see the matching change in live-events-ws.ts which now returns
      // silently on non-match rather than destroying.
      if (!url.pathname.startsWith("/api/companies/") || !url.pathname.endsWith("/events/ws")) {
        // Unknown path AND not the live-events pattern — definitively unhandled.
        rejectUpgrade(socket, "404 Not Found", "no websocket endpoint at this path");
      }
      return;
    }

    void authorizeBridgeUpgrade(req, opts)
      .then((userId) => {
        if (!userId) {
          rejectUpgrade(socket, "401 Unauthorized", "sign-in required");
          return;
        }
        (req as IncomingMessage & { paperclipBridgeUserId?: string }).paperclipBridgeUserId = userId;
        wss.handleUpgrade(req, socket, head, (ws: WsSocket) => {
          wss.emit("connection", ws, req);
        });
      })
      .catch((err) => {
        logger.error({ err, path: req.url }, "local bridge: upgrade authorization failed");
        rejectUpgrade(socket, "500 Internal Server Error", "upgrade failed");
      });
  });

  return wss;
}
