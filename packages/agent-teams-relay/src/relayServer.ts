import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assignmentOfferPayloadSchema,
  assignmentStateChangedPayloadSchema,
  commandEnvelopeSchema,
  commandIdSchema,
  teamMessageDeliveryPayloadSchema,
  teamMessageEventPayloadSchema,
  workerEventMessageSchema,
  workerCommandAckMessageSchema,
  workerHeartbeatMessageSchema,
  workerHelloMessageSchema,
  type NodeId,
  type OrganizationId,
  type PersonId,
  type WorkerInstanceId,
} from '@claude-teams/agent-teams-protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import { type RawData, WebSocket, WebSocketServer } from 'ws';

import { RelayCommandStore, type RelayCommandRecord } from './relayCommandStore';
import { RelayEventStore, type RelayEventRecord } from './relayEventStore';
import { RelayLeaseStore, type RelayLeaseRecord } from './relayLeaseStore';
import {
  RelayMembershipRouteStore,
  type RelayMembershipRoute,
} from './relayMembershipRouteStore';

export interface AgentTeamsRelayOptions {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly heartbeatIntervalMs?: number;
  readonly staleAfterMs?: number;
  readonly leaseDurationMs?: number;
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
  lastEventSequence: number;
}

export interface StartedAgentTeamsRelay {
  readonly httpUrl: string;
  readonly wsUrl: string;
  readonly app: FastifyInstance;
  readonly listWorkers: () => readonly ConnectedWorkerProjection[];
  readonly enqueueCommand: (input: unknown) => RelayCommandRecord;
  readonly listCommands: () => readonly RelayCommandRecord[];
  readonly listEvents: () => readonly RelayEventRecord[];
  readonly listLeases: () => readonly RelayLeaseRecord[];
  readonly listMembershipRoutes: () => readonly RelayMembershipRoute[];
  readonly close: () => Promise<void>;
}

const parseJsonMessage = (data: RawData): unknown => JSON.parse(data.toString('utf8'));

const peerDeliveryCommandId = (eventId: string, recipientMembershipId: string): string => {
  const bytes = createHash('sha256')
    .update(`agent-teams-peer-delivery:${eventId}:${recipientMembershipId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const startAgentTeamsRelay = async (
  options: AgentTeamsRelayOptions
): Promise<StartedAgentTeamsRelay> => {
  await mkdir(options.dataDir, { recursive: true });
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 2_000;
  const staleAfterMs = options.staleAfterMs ?? heartbeatIntervalMs * 3;
  const sessions = new Map<NodeId, MutableWorkerSession>();
  const app = Fastify({ logger: options.logger ?? false });
  const webSocketServer = new WebSocketServer({ noServer: true });
  const commandStore = new RelayCommandStore(options.dataDir);
  const eventStore = new RelayEventStore(options.dataDir);
  const leaseStore = new RelayLeaseStore(options.dataDir, options.leaseDurationMs);
  const membershipRouteStore = new RelayMembershipRouteStore(options.dataDir);

  const sendCommand = (session: MutableWorkerSession, record: RelayCommandRecord): void => {
    session.socket.send(
      JSON.stringify({
        type: 'relay.command',
        protocolVersion: 2,
        cursor: record.cursor,
        envelope: record.envelope,
      })
    );
    commandStore.markDelivered(record.commandId);
  };

  const sendPendingCommands = (session: MutableWorkerSession, afterCursor: number): void => {
    for (const record of commandStore.listForNodeAfter(session.hello.nodeId, afterCursor)) {
      sendCommand(session, record);
    }
  };

  const enqueueCommand = (input: unknown): RelayCommandRecord => {
    const envelope = commandEnvelopeSchema.parse(input);
    const registerMembershipRoute = (): boolean => {
      if (envelope.type !== 'assignment.offer') return false;
      const payload = assignmentOfferPayloadSchema.parse(envelope.payload);
      if (payload.membershipId !== undefined) {
        if (envelope.teamId === undefined || payload.workspaceId === undefined) {
          throw new TypeError('Routed assignment offers require team and workspace identity');
        }
        membershipRouteStore.register({
          membershipId: payload.membershipId,
          teamId: envelope.teamId,
          nodeId: envelope.targetNodeId,
          workspaceId: payload.workspaceId,
        });
        return true;
      }
      return false;
    };
    const existing = commandStore.get(envelope.commandId);
    const registeredMembershipRoute =
      existing === undefined
        ? registerMembershipRoute()
        : (() => {
            commandStore.enqueue(envelope);
            return registerMembershipRoute();
          })();
    const record = existing === undefined ? commandStore.enqueue(envelope) : existing;
    const session = sessions.get(record.targetNodeId);
    if (session !== undefined && record.status !== 'acknowledged') {
      sendCommand(session, record);
      const delivered = commandStore.get(record.commandId) ?? record;
      if (registeredMembershipRoute) reconcilePeerMessageDeliveries();
      return delivered;
    }
    if (registeredMembershipRoute) reconcilePeerMessageDeliveries();
    return record;
  };

  const assertAuthorizedPeerMessage = (
    event: ReturnType<typeof workerEventMessageSchema.parse>['envelope'],
    sourceNodeId: NodeId
  ): ReturnType<typeof teamMessageEventPayloadSchema.parse> => {
    if (
      event.teamId === undefined ||
      event.assignmentId === undefined ||
      event.attemptId === undefined ||
      event.leaseEpoch === undefined
    ) {
      throw new TypeError('Team messages require the full team assignment execution identity');
    }
    const payload = teamMessageEventPayloadSchema.parse(event.payload);
    const senderRoute = membershipRouteStore.get(payload.senderMembershipId);
    if (
      senderRoute === undefined ||
      senderRoute.teamId !== event.teamId ||
      senderRoute.nodeId !== sourceNodeId ||
      senderRoute.workspaceId !== payload.senderWorkspaceId
    ) {
      throw new TypeError('Team message sender does not match its Relay membership route');
    }
    leaseStore.expireThrough();
    const currentLease = leaseStore
      .listAll()
      .find(
        (lease) =>
          lease.assignmentId === event.assignmentId &&
          lease.attemptId === event.attemptId &&
          lease.leaseEpoch === event.leaseEpoch
      );
    if (
      currentLease === undefined ||
      !['granted', 'active'].includes(currentLease.status) ||
      currentLease.nodeId !== sourceNodeId ||
      currentLease.teamId !== event.teamId
    ) {
      throw new TypeError('Team message sender does not hold the current execution lease');
    }
    const recipientRoute = membershipRouteStore.get(payload.recipientMembershipId);
    if (recipientRoute !== undefined && recipientRoute.teamId !== event.teamId) {
      throw new TypeError('Team message recipient is not a member of the sender team');
    }
    return payload;
  };

  function reconcilePeerMessageDeliveries(): void {
    for (const event of eventStore.listAll()) {
      if (event.envelope.type !== 'team.message') continue;
      const parsedPayload = teamMessageEventPayloadSchema.safeParse(event.envelope.payload);
      if (!parsedPayload.success || event.envelope.teamId === undefined) continue;
      const payload = parsedPayload.data;
      const recipientRoute = membershipRouteStore.get(payload.recipientMembershipId);
      if (recipientRoute === undefined || recipientRoute.teamId !== event.envelope.teamId) continue;
      if (
        event.envelope.assignmentId === undefined ||
        event.envelope.attemptId === undefined ||
        event.envelope.leaseEpoch === undefined
      ) {
        continue;
      }
      const deliveryCommandId = commandIdSchema.parse(
        peerDeliveryCommandId(event.eventId, payload.recipientMembershipId)
      );
      if (commandStore.get(deliveryCommandId) !== undefined) continue;
      leaseStore.expireThrough();
      const recipientLease = leaseStore
        .listAll()
        .find(
          (lease) =>
            lease.nodeId === recipientRoute.nodeId &&
            lease.teamId === event.envelope.teamId &&
            ['granted', 'active'].includes(lease.status)
        );
      enqueueCommand({
        protocolVersion: 2,
        commandId: deliveryCommandId,
        sequence: event.cursor,
        teamId: event.envelope.teamId,
        targetNodeId: recipientRoute.nodeId,
        ...(recipientLease === undefined
          ? {}
          : {
              assignmentId: recipientLease.assignmentId,
              attemptId: recipientLease.attemptId,
              leaseEpoch: recipientLease.leaseEpoch,
            }),
        type: 'team.message.deliver',
        payload: teamMessageDeliveryPayloadSchema.parse({
          ...payload,
          messageId: event.eventId,
          recipientWorkspaceId: recipientRoute.workspaceId,
          sourceAssignmentId: event.envelope.assignmentId,
          sourceAttemptId: event.envelope.attemptId,
          sourceLeaseEpoch: event.envelope.leaseEpoch,
          sentAt: event.envelope.occurredAt,
        }),
      });
    }
  }

  const maybeGrantNextAssignment = (nodeId: NodeId): void => {
    leaseStore.expireThrough();
    for (const event of eventStore.listLatestAssignmentEventsForNode(nodeId)) {
      const assignmentId = event.envelope.assignmentId;
      if (assignmentId === undefined) continue;
      const state = assignmentStateChangedPayloadSchema.parse(event.envelope.payload);
      if (state.state !== 'queued') continue;
      const grant = leaseStore.grantIfCapacity({
        assignmentId,
        assignmentRevision: state.revision,
        nodeId,
        ...(event.envelope.teamId === undefined ? {} : { teamId: event.envelope.teamId }),
      });
      if (grant !== undefined) enqueueCommand(grant.command);
      return;
    }
  };

  const listWorkers = (): readonly ConnectedWorkerProjection[] => {
    const now = Date.now();
    return [...sessions.values()]
      .map(
        (session): ConnectedWorkerProjection => ({
          organizationId: session.hello.organizationId,
          personId: session.hello.personId,
          nodeId: session.hello.nodeId,
          workerInstanceId: session.hello.workerInstanceId,
          workerGeneration: session.hello.workerGeneration,
          label: session.hello.label,
          connectedAt: session.connectedAt,
          lastHeartbeatAt: session.lastHeartbeatAt,
          lastHeartbeatSequence: session.lastHeartbeatSequence,
          status: now - Date.parse(session.lastHeartbeatAt) <= staleAfterMs ? 'connected' : 'stale',
        })
      )
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
  app.get('/v2/commands', async () => ({ commands: commandStore.listAll() }));
  app.get('/v2/events', async () => ({ events: eventStore.listAll() }));
  app.get('/v2/leases', async () => ({ leases: leaseStore.listAll() }));
  app.get('/v2/membership-routes', async () => ({ routes: membershipRouteStore.listAll() }));
  app.get('/v2/commands/:commandId', async (request, reply) => {
    const rawCommandId = (request.params as { commandId?: unknown }).commandId;
    const commandId = commandIdSchema.parse(rawCommandId);
    const command = commandStore.get(commandId);
    if (command === undefined) return reply.code(404).send({ error: 'command_not_found' });
    return { command };
  });
  app.post('/v2/commands', async (request, reply) => {
    const command = enqueueCommand(request.body);
    return reply.code(201).send({ command });
  });

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
            lastEventSequence: eventStore.lastSequenceForNode(hello.nodeId),
          });
          commandStore.acknowledgeThrough(hello.nodeId, hello.lastInboundCursor);
          socket.send(
            JSON.stringify({
              type: 'relay.welcome',
              protocolVersion: 2,
              insecureLanMode: true,
              heartbeatIntervalMs,
              connectedAt,
            })
          );
          const currentSession = sessions.get(hello.nodeId);
          if (currentSession !== undefined) {
            sendPendingCommands(currentSession, hello.lastInboundCursor);
          }
          maybeGrantNextAssignment(hello.nodeId);
          void persistProjection();
          return;
        }

        const session = sessions.get(boundNodeId);
        if (session === undefined || session.socket !== socket) {
          socket.close(4002, 'Worker session is no longer current');
          return;
        }
        const inputType =
          typeof input === 'object' && input !== null && 'type' in input ? input.type : undefined;
        if (inputType === 'worker.command_ack') {
          const acknowledgement = workerCommandAckMessageSchema.parse(input);
          const stored = commandStore.get(acknowledgement.commandId);
          if (
            stored === undefined ||
            stored.targetNodeId !== boundNodeId ||
            stored.cursor !== acknowledgement.cursor
          ) {
            socket.close(4004, 'Command acknowledgement does not match delivery');
            return;
          }
          commandStore.acknowledge(
            acknowledgement.commandId,
            boundNodeId,
            acknowledgement.status,
            acknowledgement.error
          );
          return;
        }
        if (inputType === 'worker.event') {
          const message = workerEventMessageSchema.parse(input);
          if (message.envelope.sourceNodeId !== boundNodeId) {
            socket.close(4005, 'Worker event node does not match the current session');
            return;
          }
          if (message.envelope.type === 'assignment.state_changed') {
            if (message.envelope.assignmentId === undefined) {
              socket.close(4007, 'Assignment state event is missing assignment identity');
              return;
            }
            assignmentStateChangedPayloadSchema.parse(message.envelope.payload);
          }
          if (message.envelope.type === 'team.message') {
            assertAuthorizedPeerMessage(message.envelope, boundNodeId);
          }
          const existing = eventStore.get(message.envelope.eventId);
          if (
            existing === undefined &&
            message.envelope.sequence !== session.lastEventSequence + 1
          ) {
            socket.close(4006, 'Worker event sequence is not contiguous');
            return;
          }
          eventStore.accept(message.envelope);
          if (message.envelope.type === 'team.message') {
            reconcilePeerMessageDeliveries();
          }
          session.lastEventSequence = Math.max(
            session.lastEventSequence,
            message.envelope.sequence
          );
          socket.send(
            JSON.stringify({
              type: 'relay.event_ack',
              protocolVersion: 2,
              eventId: message.envelope.eventId,
              sequence: message.envelope.sequence,
              receivedAt: new Date().toISOString(),
            })
          );
          const state =
            message.envelope.type === 'assignment.state_changed'
              ? assignmentStateChangedPayloadSchema.parse(message.envelope.payload)
              : undefined;
          if (state?.state === 'leased') {
            if (
              message.envelope.assignmentId !== undefined &&
              message.envelope.attemptId !== undefined &&
              message.envelope.leaseEpoch !== undefined
            ) {
              leaseStore.markActive(
                message.envelope.assignmentId,
                message.envelope.attemptId,
                message.envelope.leaseEpoch
              );
            }
          } else if (
            state !== undefined &&
            ['rejected', 'completed', 'cancelled', 'failed', 'fenced'].includes(state.state) &&
            message.envelope.assignmentId !== undefined
          ) {
            leaseStore.release(
              message.envelope.assignmentId,
              message.envelope.attemptId,
              message.envelope.leaseEpoch
            );
          }
          maybeGrantNextAssignment(boundNodeId);
          return;
        }

        const heartbeat = workerHeartbeatMessageSchema.parse(input);
        if (heartbeat.sequence <= session.lastHeartbeatSequence) {
          socket.close(4003, 'Heartbeat sequence must increase');
          return;
        }
        session.lastHeartbeatAt = new Date().toISOString();
        session.lastHeartbeatSequence = heartbeat.sequence;
        const leaseReconciliation =
          heartbeat.activeLease === undefined
            ? ({ action: 'none' } as const)
            : leaseStore.reconcileHeartbeatLease(
                boundNodeId,
                heartbeat.activeLease,
                new Date(session.lastHeartbeatAt)
              );
        socket.send(
          JSON.stringify({
            type: 'relay.heartbeat_ack',
            protocolVersion: 2,
            sequence: heartbeat.sequence,
            receivedAt: session.lastHeartbeatAt,
            leaseReconciliation,
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

  reconcilePeerMessageDeliveries();

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
    enqueueCommand,
    listCommands: () => commandStore.listAll(),
    listEvents: () => eventStore.listAll(),
    listLeases: () => leaseStore.listAll(),
    listMembershipRoutes: () => membershipRouteStore.listAll(),
    close: async () => {
      for (const session of sessions.values()) {
        session.socket.close(1001, 'Relay shutting down');
      }
      sessions.clear();
      webSocketServer.close();
      await app.close();
      commandStore.close();
      eventStore.close();
      leaseStore.close();
      membershipRouteStore.close();
    },
  };
};
