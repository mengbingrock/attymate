// AttyMate bridge client (main process).
//
// Maintains a persistent WebSocket to the Paperclip server's /api/local-bridge/ws.
// Auth piggybacks on the webview's session cookie — we pull the cookie out of
// session.defaultSession and send it in the WS upgrade headers, since the WS
// is opened from Node.js (not from inside the webview).
//
// Protocol (matches server/src/realtime/local-bridge-ws.ts):
//   Server → Client    { type: "request",  id, op, ...args }
//   Client → Server    { type: "response", id, ok: true,  ...result }
//                  or  { type: "response", id, ok: false, error, code? }
//
// F3 deliverable is the channel + a handler registry stub. F4 plugs the
// actual `read` op handler in. Until then, unknown ops respond with
// `{ ok: false, error: "op_not_implemented" }`.

import { session as electronSession } from "electron";
import { URL } from "node:url";
import WebSocket from "ws";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const PING_INTERVAL_MS = 25_000;
const COOKIE_POLL_MS = 5_000;

/**
 * Map of op name → async handler. Handlers receive the parsed args and return
 * the response payload (which gets sent back as { ok: true, ...payload }).
 * Throwing rejects the call ({ ok: false, error: err.message }).
 *
 * F3 leaves this empty so the channel is wired but inert. F4 will register
 * a "read" handler that reads files from the user's granted workspace.
 */
const opHandlers = new Map();

export function registerOpHandler(op, handler) {
  opHandlers.set(op, handler);
}

function pickServerOrigin(appUrl) {
  // Drop trailing slashes; convert https://x → wss://x; http → ws.
  const u = new URL(appUrl);
  const proto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${u.host}`;
}

async function readSessionCookieHeader(appUrl) {
  try {
    const cookies = await electronSession.defaultSession.cookies.get({ url: appUrl });
    if (cookies.length === 0) return null;
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return null;
  }
}

class BridgeClient {
  constructor(appUrl) {
    this.appUrl = appUrl;
    this.serverOrigin = pickServerOrigin(appUrl);
    this.ws = null;
    this.reconnectAttempt = 0;
    this.shuttingDown = false;
    this.reconnectTimer = null;
    this.pingTimer = null;
  }

  start() {
    if (this.shuttingDown) return;
    void this.tryConnect();
  }

  stop() {
    this.shuttingDown = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.ws) {
      try {
        this.ws.close(1000, "shutdown");
      } catch {
        /* ignore */
      }
    }
  }

  scheduleReconnect(reason) {
    if (this.shuttingDown) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** Math.min(this.reconnectAttempt - 1, 6),
    );
    console.log(`[bridge] reconnect in ${delay}ms (attempt ${this.reconnectAttempt}, reason: ${reason})`);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.tryConnect();
    }, delay);
  }

  async tryConnect() {
    if (this.shuttingDown) return;
    const cookieHeader = await readSessionCookieHeader(this.appUrl);
    if (!cookieHeader) {
      // No session yet — user hasn't signed in. Poll for it slowly so we
      // connect promptly once they do, without thrashing the server.
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        void this.tryConnect();
      }, COOKIE_POLL_MS);
      return;
    }

    const wsUrl = `${this.serverOrigin}/api/local-bridge/ws`;
    console.log(`[bridge] connecting to ${wsUrl}`);
    const ws = new WebSocket(wsUrl, {
      headers: { Cookie: cookieHeader },
    });
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempt = 0;
      console.log(`[bridge] connected`);
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, PING_INTERVAL_MS);
    });

    ws.on("message", (data) => {
      this.handleIncoming(ws, data).catch((err) => {
        console.error("[bridge] handler error:", err);
      });
    });

    ws.on("close", (code, reasonBuf) => {
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      const reason = reasonBuf?.toString() || `code=${code}`;
      console.log(`[bridge] closed (${reason})`);
      this.ws = null;
      this.scheduleReconnect(reason);
    });

    ws.on("error", (err) => {
      console.warn(`[bridge] socket error:`, err.message);
      // close event fires after error; reconnect happens there.
    });
  }

  async handleIncoming(ws, data) {
    let msg;
    try {
      msg = JSON.parse(data.toString("utf-8"));
    } catch {
      return;
    }
    if (!msg || msg.type !== "request" || typeof msg.id !== "string" || typeof msg.op !== "string") {
      return;
    }
    const handler = opHandlers.get(msg.op);
    if (!handler) {
      this.send(ws, { type: "response", id: msg.id, ok: false, error: `op_not_implemented:${msg.op}` });
      return;
    }
    try {
      const result = await handler(msg);
      this.send(ws, { type: "response", id: msg.id, ok: true, ...(result ?? {}) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.send(ws, { type: "response", id: msg.id, ok: false, error: message });
    }
  }

  send(ws, msg) {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      console.warn(`[bridge] send failed:`, err);
    }
  }
}

let singleton = null;

export function startBridgeClient(appUrl) {
  if (singleton) return singleton;
  singleton = new BridgeClient(appUrl);
  singleton.start();
  return singleton;
}

export function stopBridgeClient() {
  if (singleton) {
    singleton.stop();
    singleton = null;
  }
}
