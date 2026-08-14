import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  workerHeartbeatMessageSchema,
  workerHelloMessageSchema,
  type NodeId,
  type OrganizationId,
  type PersonId,
  type WorkerInstanceId,
} from '@claude-teams/agent-teams-protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import { type RawData, WebSocket, WebSocketServer } from 'ws';

export interface AgentTeamsRelayOptions {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly heartbeatIntervalMs?: number;
  readonly staleAfterMs?: number;
  readonly logger?: boolean;
}

export interface ConnectedWorkerProjection {
  readonly organizationId: OrganizationId;
  readonly personId: PersonId;
  readonly nodeId: NodeId;
  readonly workerInstanceId: WorkerInstanceId;
  readonly workerGeneration: number;
  readonly label: string;
  readonly connectedAt: string;
  readonly lastHeartbeatAt: string;
  readonly lastHeartbeatSequence: number;
  readonly status: 'connected' | 'stale';
}

interface MutableWorkerSession {
  hello: ReturnType<typeof workerHelloMessageSchema.parse>;
  socket: WebSocket;
  connectedAt: string;
  lastHeartbeatAt: string;
  lastHeartbeatSequence: number;
}

export interface StartedAgentTeamsRelay {
  readonly httpUrl: string;
  readonly wsUrl: string;
  readonly app: FastifyInstance;
  readonly listWorkers: () => readonly ConnectedWorkerProjection[];
  readonly close: () => Promise<void>;
}

const parseJsonMessage = (data: RawData): unknown => JSON.parse(data.toString('utf8'));

export const startAgentTeamsRelay = async (
  options: AgentTeamsRelayOptions
): Promise<StartedAgentTeamsRelay> => {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 2_000;
  const staleAfterMs = options.staleAfterMs ?? heartbeatIntervalMs * 3;
  const sessions = new Map<NodeId, MutableWorkerSession>();
  const app = Fastify({ logger: options.logger ?? false });
  const webSocketServer = new WebSocketServer({ noServer: true });

  const listWorkers = (): readonly ConnectedWorkerProjection[] => {
    const now = Date.now();
    return [...sessions.values()]
      .map((session): ConnectedWorkerProjection => ({
        organizationId: session.hello.organizationId,
        personId: session.hello.personId,
        nodeId: session.hello.nodeId,
        workerInstanceId: session.hello.workerInstanceId,
        workerGeneration: session.hello.workerGeneration,
        label: session.hello.label,
        connectedAt: session.connectedAt,
        lastHeartbeatAt: session.lastHeartbeatAt,
        lastHeartbeatSequence: session.lastHeartbeatSequence,
        status:
          now - Date.parse(session.lastHeartbeatAt) <= staleAfterMs ? 'connected' : 'stale',
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  };

  const persistProjection = async (): Promise<void> => {
    await writeFile(
      join(options.dataDir, 'connected-workers.json'),
      `${JSON.stringify({ updatedAt: new Date().toISOString(), workers: listWorkers() }, null, 2)}\n`,
      'utf8'
    );
  };

  app.get('/health', async () => ({
    ok: true,
    service: 'agent-teams-relay',
    protocolVersion: 2,
    insecureLanMode: true,
  }));
  app.get('/ready', async () => ({ ok: true }));
  app.get('/v2/workers', async () => ({
    insecureLanMode: true,
    workers: listWorkers(),
  }));

  app.server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url ?? '/', 'http://relay.local');
    if (requestUrl.pathname !== '/v2/worker-stream') {
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request);
    });
  });

  webSocketServer.on('connection', (socket) => {
    let boundNodeId: NodeId | undefined;

    socket.on('message', (data) => {
      try {
        const input = parseJsonMessage(data);
        if (boundNodeId === undefined) {
          const hello = workerHelloMessageSchema.parse(input);
          const previous = sessions.get(hello.nodeId);
          if (previous !== undefined && previous.socket !== socket) {
            previous.socket.close(4001, 'Replaced by newer Worker session');
          }

          const connectedAt = new Date().toISOString();
          boundNodeId = hello.nodeId;
          sessions.set(hello.nodeId, {
            hello,
            socket,
            connectedAt,
            lastHeartbeatAt: connectedAt,
            lastHeartbeatSequence: 0,
          });
          socket.send(
            JSON.stringify({
              type: 'relay.welcome',
              protocolVersion: 2,
              insecureLanMode: true,
              heartbeatIntervalMs,
              connectedAt,
            })
          );
          void persistProjection();
          return;
        }

        const heartbeat = workerHeartbeatMessageSchema.parse(input);
        const session = sessions.get(boundNodeId);
        if (session === undefined || session.socket !== socket) {
          socket.close(4002, 'Worker session is no longer current');
          return;
        }
        if (heartbeat.sequence <= session.lastHeartbeatSequence) {
          socket.close(4003, 'Heartbeat sequence must increase');
          return;
        }
        session.lastHeartbeatAt = new Date().toISOString();
        session.lastHeartbeatSequence = heartbeat.sequence;
        socket.send(
          JSON.stringify({
            type: 'relay.heartbeat_ack',
            protocolVersion: 2,
            sequence: heartbeat.sequence,
            receivedAt: session.lastHeartbeatAt,
          })
        );
        void persistProjection();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid Worker message';
        socket.send(
          JSON.stringify({
            type: 'relay.error',
            protocolVersion: 2,
            code: 'INVALID_MESSAGE',
            message: message.slice(0, 512),
          })
        );
        socket.close(4000, 'Invalid Worker message');
      }
    });

    socket.on('close', () => {
      if (boundNodeId === undefined) return;
      const session = sessions.get(boundNodeId);
      if (session?.socket === socket) {
        sessions.delete(boundNodeId);
        void persistProjection();
      }
    });
  });

  await mkdir(options.dataDir, { recursive: true });
  await app.listen({ host: options.host, port: options.port });
  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    await app.close();
    throw new Error('Relay did not bind a TCP address');
  }
  const advertisedHost = options.host === '0.0.0.0' ? '127.0.0.1' : options.host;
  const httpUrl = `http://${advertisedHost}:${address.port}`;

  return {
    httpUrl,
    wsUrl: `${httpUrl.replace(/^http/, 'ws')}/v2/worker-stream`,
    app,
    listWorkers,
    close: async () => {
      for (const session of sessions.values()) {
        session.socket.close(1001, 'Relay shutting down');
      }
      sessions.clear();
      webSocketServer.close();
      await app.close();
    },
  };
};
