import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import type { Server } from 'node:http';
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
      const pending = new Map<string | number, string>();
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
                pending.set(message.id, prepared.bindingId);
            }
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
            const bindingId = pending.get(id);
            if (bindingId) {
              pending.delete(id);
              const threadId = object(object(message.result).thread).id;
              if (typeof threadId === 'string')
                await requestWorkerControl(controlSocket, '/v2/desktop-chat/bind', {
                  method: 'POST',
                  body: { bindingId, threadId },
                });
            }
            if (client.readyState === WebSocket.OPEN) client.send(data.toString());
          })
          .catch(() => client.close(1011, 'Could not persist team chat binding'));
      });
      client.on('close', () => upstream.close());
      upstream.on('close', () => client.close());
      client.on('error', () => upstream.close());
      upstream.on('error', () => client.close());
    });
  });
  return () => {
    for (const client of wss.clients) client.terminate();
    wss.close();
  };
};
