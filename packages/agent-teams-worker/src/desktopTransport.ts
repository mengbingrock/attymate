import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import type { Server } from 'node:http';

import { SESSION_HEARTBEAT_MS, SESSION_EXPIRES_MS } from '@claude-teams/agent-teams-protocol';
import WebSocket, { WebSocketServer } from 'ws';

import { requestWorkerControl } from './workerControlServer';
import { localAppServerWebSocket } from './localAppServerWebSocket';

const object = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
export const mergeDesktopTeamConfig = (
  params: Record<string, unknown>,
  injected: Record<string, unknown>
) => {
  const supplied = object(params.config);
  const disabled = (value: unknown) =>
    Object.fromEntries(Object.keys(object(value)).map((name) => [name, { enabled: false }]));
  return {
    ...params,
    config: {
      ...Object.fromEntries(
        Object.entries(supplied).filter(
          ([key]) => !/^(mcp_servers|plugins|apps|features)\./.test(key)
        )
      ),
      ...injected,
      mcp_servers: { ...disabled(supplied.mcp_servers), ...object(injected.mcp_servers) },
      plugins: { ...disabled(supplied.plugins), ...object(injected.plugins) },
      apps: {
        ...disabled(supplied.apps),
        ...object(injected.apps),
        _default: {
          enabled: false,
          destructive_enabled: false,
          default_tools_approval_mode: 'prompt',
        },
      },
    },
  };
};

/** Adds only the Worker-owned team configuration; all other desktop RPCs pass through. */
export const attachDesktopTransport = (
  server: Server,
  capabilityPath: string,
  socketPath: string,
  controlSocket: string
) => {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== capabilityPath) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      const upstream = socketPath.startsWith('ws:')
        ? localAppServerWebSocket(socketPath, process.env.AGENT_TEAMS_APP_SERVER_TOKEN)
        : new WebSocket('ws://localhost/', {
            createConnection: () => createConnection(socketPath),
            maxPayload: 32 * 1024 * 1024,
          });
      const ready = new Promise<void>((resolve, reject) => {
        upstream.once('open', resolve);
        upstream.once('error', reject);
      });
      void ready.catch(() => client.close());
      const connectionId = randomUUID();
      let closed = false;
      let registered = false;
      let lastClientPong = performance.now();
      let lastUpstreamPong = performance.now();
      let ping = '';
      client.on('pong', (data) => {
        if (data.toString() === ping) lastClientPong = performance.now();
      });
      upstream.on('pong', (data) => {
        if (data.toString() === ping) lastUpstreamPong = performance.now();
      });
      const detach = (threadId?: string) =>
        requestWorkerControl(controlSocket, '/v2/desktop-chat/presence', {
          method: 'POST',
          body: { action: 'detach', connectionId, ...(threadId ? { threadId } : {}) },
        });
      let checking = false;
      const healthTimer = setInterval(() => {
        if (closed) return;
        const ageMs = Math.max(0, performance.now() - Math.min(lastClientPong, lastUpstreamPong));
        if (ageMs >= SESSION_EXPIRES_MS) {
          client.terminate();
          upstream.terminate();
          return;
        }
        if (client.readyState !== WebSocket.OPEN || upstream.readyState !== WebSocket.OPEN) return;
        ping = randomUUID();
        client.ping(ping);
        upstream.ping(ping);
        if (!registered || checking) return;
        checking = true;
        void requestWorkerControl(controlSocket, '/v2/desktop-chat/presence', {
          method: 'POST',
          body: { action: 'heartbeat', connectionId, ageMs },
        })
          .catch(() => {
            client.close(1011, 'Team presence unavailable');
          })
          .finally(() => {
            checking = false;
          });
      }, SESSION_HEARTBEAT_MS);
      healthTimer.unref();
      const disconnected = () => {
        if (closed) return;
        closed = true;
        clearInterval(healthTimer);
        if (registered) void detach().catch(() => undefined);
      };
      const pending = new Map<string | number, { bindingId: string; presence: boolean }>();
      const detaching = new Map<string | number, string>();
      let incoming = Promise.resolve();
      let outgoing = Promise.resolve();
      client.on('message', (data) => {
        incoming = incoming
          .then(async () => {
            await ready;
            const message = JSON.parse(data.toString()) as Record<string, unknown>;
            const params = object(message.params);
            if (
              message.method === 'thread/start' ||
              message.method === 'thread/resume' ||
              message.method === 'turn/start'
            ) {
              const prepared = await requestWorkerControl<{
                bindingId?: string;
                presenceVersion?: number;
                config?: Record<string, unknown>;
              }>(controlSocket, '/v2/desktop-chat/prepare', {
                method: 'POST',
                body: {
                  method: message.method,
                  requestId: randomUUID(),
                  ...(typeof params.threadId === 'string' ? { threadId: params.threadId } : {}),
                },
              });
              if (prepared.config) message.params = mergeDesktopTeamConfig(params, prepared.config);
              else if (prepared.bindingId && message.method === 'turn/start') {
                const { config: _config, ...turnParams } = params;
                message.params = turnParams;
              }
              if (
                (message.method === 'thread/start' || message.method === 'thread/resume') &&
                prepared.bindingId &&
                (typeof message.id === 'number' || typeof message.id === 'string')
              )
                pending.set(message.id, {
                  bindingId: prepared.bindingId,
                  presence: prepared.presenceVersion === 1,
                });
            }
            if (
              (message.method === 'thread/unsubscribe' || message.method === 'thread/archive') &&
              typeof params.threadId === 'string' &&
              (typeof message.id === 'string' || typeof message.id === 'number')
            )
              detaching.set(message.id, params.threadId);
            upstream.send(JSON.stringify(message));
          })
          .catch(() => {
            // Fail closed: never quietly open a selected team chat without its tools.
            let message: Record<string, unknown>;
            try {
              message = object(JSON.parse(data.toString()));
            } catch {
              client.close(1007, 'Invalid JSON');
              return;
            }
            if (client.readyState !== WebSocket.OPEN) return;
            client.send(
              JSON.stringify({
                id: message.id,
                error: {
                  code: -32000,
                  message: 'Team connection unavailable. Check the Worker and selected membership.',
                },
              })
            );
          });
      });
      upstream.on('message', (data) => {
        outgoing = outgoing
          .then(async () => {
            const message = object(JSON.parse(data.toString()));
            const id = message.id as string | number;
            const detachedThread = detaching.get(id);
            detaching.delete(id);
            if (detachedThread && !message.error && registered) await detach(detachedThread);
            const binding = pending.get(id);
            if (binding) {
              pending.delete(id);
              const threadId = object(object(message.result).thread).id;
              if (typeof threadId === 'string' && !closed) {
                await requestWorkerControl(controlSocket, '/v2/desktop-chat/bind', {
                  method: 'POST',
                  body: {
                    bindingId: binding.bindingId,
                    threadId,
                    ...(binding.presence ? { connectionId } : {}),
                  },
                });
                if (binding.presence) {
                  registered = true;
                  // A close racing the async validation must not resurrect presence.
                  if (closed) await detach();
                  else {
                    const ageMs = Math.max(
                      0,
                      performance.now() - Math.min(lastClientPong, lastUpstreamPong)
                    );
                    if (ageMs >= SESSION_EXPIRES_MS) {
                      await detach();
                      client.close();
                    } else
                      await requestWorkerControl(controlSocket, '/v2/desktop-chat/presence', {
                        method: 'POST',
                        body: { action: 'heartbeat', connectionId, ageMs },
                      });
                  }
                }
              }
            }
            if (client.readyState === WebSocket.OPEN) client.send(data.toString());
          })
          .catch(() => client.close(1011, 'Could not persist team chat binding'));
      });
      client.on('close', () => {
        disconnected();
        upstream.close();
      });
      upstream.on('close', () => {
        disconnected();
        client.close();
      });
      client.on('error', () => {
        disconnected();
        upstream.close();
      });
      upstream.on('error', () => {
        disconnected();
        client.close();
      });
    });
  });
  return () => {
    for (const client of wss.clients) client.terminate();
    wss.close();
  };
};
