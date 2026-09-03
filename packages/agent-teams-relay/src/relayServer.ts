import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assignmentOfferPayloadSchema,
  assignmentStateChangedPayloadSchema,
  commandEnvelopeSchema,
  commandIdSchema,
  joinTeamMemberRequestSchema,
  leaveTeamMemberRequestSchema,
  membershipIdSchema,
  runtimeControlSchema,
  runtimeSessionCreateRequestSchema,
  runtimeSessionIdSchema,
  teamMessageDeliveryPayloadSchema,
  teamMessageEventPayloadSchema,
  teamMemberJoinRequestedPayloadSchema,
  teamMemberLeaveRequestedPayloadSchema,
  teamMembershipSnapshotPayloadSchema,
  teamIdSchema,
  workspaceIdSchema,
  workerRuntimeEventMessageSchema,
  workerEventMessageSchema,
  workerCommandAckMessageSchema,
  workerHeartbeatMessageSchema,
  workerHelloMessageSchema,
  type AssignmentId,
  type MembershipId,
  type NodeId,
  type OrganizationId,
  type PersonId,
  type TeamId,
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
import {
  RelayRuntimeSessionAuthorizationError,
  RelayRuntimeSessionStore,
} from './relayRuntimeSessionStore';

export interface AgentTeamsRelayOptions {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly heartbeatIntervalMs?: number;
  readonly staleAfterMs?: number;
  readonly leaseDurationMs?: number;
  readonly logger?: boolean;
  readonly auth?: {
    readonly managerToken: string;
    readonly workerToken: string;
  };
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
  readonly autoJoinTeamId?: TeamId;
  readonly runtimeCapabilities: NonNullable<
    ReturnType<typeof workerHelloMessageSchema.parse>['runtimeCapabilities']
  >;
  readonly status: 'connected' | 'stale';
}

const MEMBERSHIP_REACTIVATION_GRACE_MS = 30_000;

interface MutableWorkerSession {
  hello: ReturnType<typeof workerHelloMessageSchema.parse>;
  socket: WebSocket;
  connectedAt: string;
  lastHeartbeatAt: string;
  lastHeartbeatSequence: number;
  lastEventSequence: number;
  activeLease?: {
    readonly assignmentId: string;
    readonly attemptId: string;
    readonly leaseId: string;
    readonly leaseEpoch: number;
  };
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

const normalizeToken = (value: string, label: string): string => {
  const token = value.trim();
  if (token.length < 32 || token.length > 512) {
    throw new TypeError(`${label} must contain 32-512 characters`);
  }
  return token;
};

const tokenMatches = (authorization: string | undefined, expected: string): boolean => {
  if (authorization === undefined || !authorization.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(authorization.slice('Bearer '.length), 'utf8');
  const required = Buffer.from(expected, 'utf8');
  return supplied.length === required.length && timingSafeEqual(supplied, required);
};

const bearerValue = (authorization: string | undefined): string | undefined =>
  authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined;

const isRuntimeCapabilityPath = (url: string): boolean =>
  /^\/v2\/runtime-sessions\/[^/?]+\/(events|controls)(?:[?]|$)/.test(url);

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

const deterministicRouteId = (kind: 'membership' | 'workspace', teamId: TeamId, nodeId: NodeId) => {
  const bytes = createHash('sha256')
    .update(`agent-teams-auto-join:${kind}:${teamId}:${nodeId}`)
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
  const runtimeSessionStore = new RelayRuntimeSessionStore();
  const auth =
    options.auth === undefined
      ? undefined
      : {
          managerToken: normalizeToken(options.auth.managerToken, 'managerToken'),
          workerToken: normalizeToken(options.auth.workerToken, 'workerToken'),
        };
  const insecureLanMode = auth === undefined;

  app.addHook('onRequest', async (request, reply) => {
    if (
      !request.url.startsWith('/v2/') ||
      isRuntimeCapabilityPath(request.url) ||
      auth === undefined
    ) {
      return;
    }
    if (!tokenMatches(request.headers.authorization, auth.managerToken)) {
      await reply.code(401).send({ error: 'manager_authentication_required' });
    }
  });

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
    const existing = commandStore.get(envelope.commandId);
    if (existing !== undefined) {
      const record = commandStore.enqueue(envelope);
      const session = sessions.get(record.targetNodeId);
      if (session !== undefined && record.status !== 'acknowledged') {
        sendCommand(session, record);
        return commandStore.get(record.commandId) ?? record;
      }
      return record;
    }
    const registerMembershipRoute = (): RelayMembershipRoute | undefined => {
      if (envelope.type !== 'assignment.offer') return undefined;
      const payload = assignmentOfferPayloadSchema.parse(envelope.payload);
      if (payload.membershipId !== undefined) {
        if (envelope.teamId === undefined || payload.workspaceId === undefined) {
          throw new TypeError('Routed assignment offers require team and workspace identity');
        }
        const route = membershipRouteStore.register({
          membershipId: payload.membershipId,
          teamId: envelope.teamId,
          nodeId: envelope.targetNodeId,
          workspaceId: payload.workspaceId,
          label: sessions.get(envelope.targetNodeId)?.hello.label,
          ...(payload.teamRole === undefined ? {} : { role: payload.teamRole }),
        });
        return route;
      }
      return undefined;
    };
    const registeredMembershipRoute = registerMembershipRoute();
    const record = commandStore.enqueue(envelope);
    const session = sessions.get(record.targetNodeId);
    if (session !== undefined && record.status !== 'acknowledged') {
      sendCommand(session, record);
      const delivered = commandStore.get(record.commandId) ?? record;
      if (registeredMembershipRoute !== undefined) {
        broadcastMembershipSnapshot(registeredMembershipRoute.teamId);
        reconcilePeerMessageDeliveries();
      }
      return delivered;
    }
    if (registeredMembershipRoute !== undefined) {
      broadcastMembershipSnapshot(registeredMembershipRoute.teamId);
      reconcilePeerMessageDeliveries();
    }
    return record;
  };

  function broadcastMembershipSnapshot(teamIdInput: string, additionalNodeIds: NodeId[] = []): void {
    const teamId = teamIdSchema.parse(teamIdInput);
    const members = membershipRouteStore.listActiveForTeam(teamId);
    const payload = teamMembershipSnapshotPayloadSchema.parse({
      teamId,
      members: members.map((route) => ({
        membershipId: route.membershipId,
        teamId: route.teamId,
        nodeId: route.nodeId,
        workspaceId: route.workspaceId,
        label: route.label,
        role: route.role,
        status: route.status,
        revision: route.revision,
        joinedAt: route.createdAt,
        updatedAt: route.updatedAt,
        ...(route.leftAt === undefined ? {} : { leftAt: route.leftAt }),
      })),
      generatedAt: new Date().toISOString(),
    });
    const targetNodeIds = new Set<NodeId>([
      ...members.map((member) => member.nodeId),
      ...additionalNodeIds,
    ]);
    for (const targetNodeId of targetNodeIds) {
      enqueueCommand({
        protocolVersion: 2,
        commandId: randomUUID(),
        sequence: Date.now(),
        teamId,
        targetNodeId,
        type: 'team.membership.snapshot',
        payload,
      });
    }
  }

  const joinTeamMember = (
    teamIdInput: string,
    input: unknown
  ): {
    readonly membership: RelayMembershipRoute;
    readonly assignmentId: string;
    readonly commandIds: readonly string[];
  } => {
    const teamId = teamIdSchema.parse(teamIdInput);
    const requested = joinTeamMemberRequestSchema.parse(input);
    const worker = sessions.get(requested.targetNodeId);
    if (worker === undefined) throw new TypeError('Target Worker must be connected before joining');
    const membershipId = membershipIdSchema.parse(requested.membershipId ?? randomUUID());
    const workspaceId = requested.workspaceId ?? randomUUID();
    const assignmentId = randomUUID();
    const role = requested.role ?? (membershipRouteStore.activeLead(teamId) ? 'member' : 'lead');
    const offer = enqueueCommand({
      protocolVersion: 2,
      commandId: randomUUID(),
      sequence: Date.now(),
      teamId,
      targetNodeId: requested.targetNodeId,
      assignmentId,
      type: 'assignment.offer',
      payload: {
        assignmentId,
        membershipId,
        workspaceId,
        teamRole: role,
        title: requested.title ?? (role === 'lead' ? 'Lead the distributed team' : 'Join the distributed team'),
        description:
          requested.description ??
          (role === 'lead'
            ? 'Coordinate the active roster, delegate work, and collect teammate reports.'
            : 'Join the team, accept delegated work, and report results to the team lead.'),
      },
    });
    const accept = enqueueCommand({
      protocolVersion: 2,
      commandId: randomUUID(),
      sequence: Date.now() + 1,
      teamId,
      targetNodeId: requested.targetNodeId,
      assignmentId,
      type: 'assignment.accept',
      payload: {
        assignmentId,
        expectedRevision: 0,
        reason: 'joined_active_team',
      },
    });
    return {
      membership: membershipRouteStore.get(membershipId)!,
      assignmentId,
      commandIds: [offer.commandId, accept.commandId],
    };
  };

  const assignmentOffersForMembership = (membershipId: MembershipId) =>
    commandStore
      .listAll()
      .filter((command) => {
        if (command.envelope.type !== 'assignment.offer') return false;
        return (
          assignmentOfferPayloadSchema.parse(command.envelope.payload).membershipId ===
          membershipId
        );
      });

  const assignmentIdsForMembership = (membershipId: MembershipId): AssignmentId[] =>
    assignmentOffersForMembership(membershipId).flatMap((command) =>
      command.envelope.assignmentId === undefined ? [] : [command.envelope.assignmentId]
    );

  const assignmentCanContinue = (
    nodeId: NodeId,
    assignmentId: AssignmentId,
    offerCreatedAt: string
  ): boolean => {
    leaseStore.expireThrough();
    if (
      leaseStore
        .listAll()
        .some(
          (lease) =>
            lease.assignmentId === assignmentId &&
            lease.nodeId === nodeId &&
            ['granted', 'active'].includes(lease.status)
        )
    ) {
      return true;
    }
    if (
      commandStore
        .listAll()
        .some(
          (command) =>
            command.envelope.assignmentId === assignmentId &&
            ['pending', 'delivered'].includes(command.status)
        )
    ) {
      return true;
    }
    const latestStateEvent = eventStore
      .listLatestAssignmentEventsForNode(nodeId)
      .find((event) => event.envelope.assignmentId === assignmentId);
    if (latestStateEvent === undefined) {
      return Date.now() - Date.parse(offerCreatedAt) < MEMBERSHIP_REACTIVATION_GRACE_MS;
    }
    const state = assignmentStateChangedPayloadSchema.parse(latestStateEvent.envelope.payload);
    if (state.state === 'queued') return true;
    if (['rejected', 'completed', 'cancelled', 'failed', 'fenced'].includes(state.state)) {
      return false;
    }
    return (
      Date.now() - Date.parse(latestStateEvent.receivedAt) < MEMBERSHIP_REACTIVATION_GRACE_MS
    );
  };

  const reactivateActiveMembershipsForNode = (nodeId: NodeId): void => {
    if (sessions.get(nodeId) === undefined) return;
    for (const membership of membershipRouteStore
      .listAll()
      .filter((route) => route.nodeId === nodeId && route.status === 'active')) {
      const offers = assignmentOffersForMembership(membership.membershipId);
      if (
        offers.some(
          (offer) =>
            offer.envelope.assignmentId !== undefined &&
            assignmentCanContinue(nodeId, offer.envelope.assignmentId, offer.createdAt)
        )
      ) {
        continue;
      }
      const latestOffer = offers.at(-1);
      const latestPayload =
        latestOffer === undefined
          ? undefined
          : assignmentOfferPayloadSchema.parse(latestOffer.envelope.payload);
      joinTeamMember(membership.teamId, {
        targetNodeId: membership.nodeId,
        membershipId: membership.membershipId,
        workspaceId: membership.workspaceId,
        role: membership.role,
        ...(latestPayload?.title === undefined ? {} : { title: latestPayload.title }),
        ...(latestPayload?.description === undefined
          ? {}
          : { description: latestPayload.description }),
      });
    }
  };

  const reconcileAdvertisedMembershipForNode = (nodeId: NodeId): void => {
    const session = sessions.get(nodeId);
    const teamId = session?.hello.autoJoinTeamId;
    if (session === undefined || teamId === undefined) return;
    if (
      membershipRouteStore
        .listActiveForTeam(teamId)
        .some((membership) => membership.nodeId === nodeId)
    ) {
      return;
    }
    const lead = membershipRouteStore.activeLead(teamId);
    if (lead === undefined || lead.nodeId === nodeId) return;

    const membershipId = membershipIdSchema.parse(
      deterministicRouteId('membership', teamId, nodeId)
    );
    const priorEnrollment = membershipRouteStore.get(membershipId);
    if (priorEnrollment?.status === 'left') return;
    const workspaceId = workspaceIdSchema.parse(deterministicRouteId('workspace', teamId, nodeId));
    joinTeamMember(teamId, {
      targetNodeId: nodeId,
      membershipId,
      workspaceId,
      role: 'member',
      title: `Auto-join ${session.hello.label}`,
      description:
        'Join the advertised distributed team, accept delegated work, and report results to the team lead.',
    });
  };

  const pendingLeadActivations = new Map<MembershipId, RelayMembershipRoute>();
  for (const membership of membershipRouteStore.listAll()) {
    if (membership.status !== 'active' || membership.role !== 'lead' || membership.revision <= 1) {
      continue;
    }
    const alreadyHasLeadAssignment = commandStore.listAll().some((command) => {
      if (
        command.envelope.teamId !== membership.teamId ||
        command.envelope.type !== 'assignment.offer'
      ) {
        return false;
      }
      const offer = assignmentOfferPayloadSchema.parse(command.envelope.payload);
      return offer.membershipId === membership.membershipId && offer.teamRole === 'lead';
    });
    if (!alreadyHasLeadAssignment) {
      pendingLeadActivations.set(membership.membershipId, membership);
    }
  }

  const activatePendingLeadForNode = (nodeId: NodeId): void => {
    const session = sessions.get(nodeId);
    if (session === undefined || session.activeLease !== undefined) return;
    leaseStore.expireThrough();
    if (
      leaseStore
        .listAll()
        .some(
          (lease) =>
            lease.nodeId === nodeId && ['granted', 'active'].includes(lease.status)
        )
    ) {
      return;
    }
    const pending = [...pendingLeadActivations.values()].find(
      (membership) => membership.nodeId === nodeId
    );
    if (pending === undefined) return;
    pendingLeadActivations.delete(pending.membershipId);
    joinTeamMember(pending.teamId, {
      targetNodeId: pending.nodeId,
      membershipId: pending.membershipId,
      workspaceId: pending.workspaceId,
      role: 'lead',
      title: 'Continue as distributed team lead',
      description:
        'Leadership transferred to this membership. Coordinate the active roster, delegate work, and collect teammate reports.',
    });
  };

  const leaveTeamMember = (
    teamIdInput: string,
    input: unknown
  ): { readonly membership: RelayMembershipRoute; readonly releasedAssignmentIds: string[] } => {
    const teamId = teamIdSchema.parse(teamIdInput);
    const requested = leaveTeamMemberRequestSchema.parse(input);
    const before = membershipRouteStore.get(requested.membershipId);
    if (before === undefined || before.teamId !== teamId) {
      throw new TypeError('Membership does not belong to the requested team');
    }
    const membership = membershipRouteStore.leave({
      teamId,
      membershipId: requested.membershipId,
      ...(requested.expectedRevision === undefined
        ? {}
        : { expectedRevision: requested.expectedRevision }),
      ...(requested.successorMembershipId === undefined
        ? {}
        : { successorMembershipId: requested.successorMembershipId }),
    });
    const assignmentIds = assignmentIdsForMembership(membership.membershipId);
    const successor =
      requested.successorMembershipId === undefined
        ? undefined
        : membershipRouteStore.get(requested.successorMembershipId);
    const successorAssignmentIds =
      successor === undefined ? [] : assignmentIdsForMembership(successor.membershipId);
    const releasedAssignmentIds = [...assignmentIds];
    for (const assignmentId of assignmentIds) {
      for (const lease of leaseStore
        .listAll()
        .filter(
          (candidate) =>
            candidate.assignmentId === assignmentId &&
            ['granted', 'active'].includes(candidate.status)
        )) {
        leaseStore.release(assignmentId, lease.attemptId, lease.leaseEpoch);
        runtimeSessionStore.revokeScope({
          teamId,
          nodeId: lease.nodeId,
          assignmentId,
          attemptId: lease.attemptId,
          leaseId: lease.leaseId,
          leaseEpoch: lease.leaseEpoch,
        });
      }
    }
    if (successor?.status === 'active' && successor.role === 'lead') {
      pendingLeadActivations.set(successor.membershipId, successor);
      for (const assignmentId of successorAssignmentIds) {
        for (const lease of leaseStore
          .listAll()
          .filter(
            (candidate) =>
              candidate.assignmentId === assignmentId &&
              ['granted', 'active'].includes(candidate.status)
          )) {
          leaseStore.release(assignmentId, lease.attemptId, lease.leaseEpoch);
          runtimeSessionStore.revokeScope({
            teamId,
            nodeId: lease.nodeId,
            assignmentId,
            attemptId: lease.attemptId,
            leaseId: lease.leaseId,
            leaseEpoch: lease.leaseEpoch,
          });
          releasedAssignmentIds.push(assignmentId);
        }
      }
      activatePendingLeadForNode(successor.nodeId);
    }
    broadcastMembershipSnapshot(teamId, [before.nodeId]);
    return { membership, releasedAssignmentIds: [...new Set(releasedAssignmentIds)] };
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
      senderRoute.workspaceId !== payload.senderWorkspaceId ||
      senderRoute.status !== 'active'
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
    if (
      recipientRoute !== undefined &&
      (recipientRoute.teamId !== event.teamId || recipientRoute.status !== 'active')
    ) {
      throw new TypeError('Team message recipient is not a member of the sender team');
    }
    return payload;
  };

  const assertAuthorizedMembershipActor = (
    event: ReturnType<typeof workerEventMessageSchema.parse>['envelope'],
    sourceNodeId: NodeId,
    actorMembershipIdInput: string,
    targetMembershipId?: string
  ): RelayMembershipRoute => {
    if (
      event.teamId === undefined ||
      event.assignmentId === undefined ||
      event.attemptId === undefined ||
      event.leaseEpoch === undefined
    ) {
      throw new TypeError('Team membership changes require an active assignment identity');
    }
    const actorMembershipId = membershipIdSchema.parse(actorMembershipIdInput);
    const actor = membershipRouteStore.get(actorMembershipId);
    if (
      actor === undefined ||
      actor.teamId !== event.teamId ||
      actor.nodeId !== sourceNodeId ||
      actor.status !== 'active'
    ) {
      throw new TypeError('Team membership actor does not match its active Relay route');
    }
    const selfLeave = targetMembershipId === actor.membershipId;
    if (actor.role !== 'lead' && !selfLeave) {
      throw new TypeError('Only the active team lead can change another membership');
    }
    leaseStore.expireThrough();
    const holdsLease = leaseStore.listAll().some(
      (lease) =>
        lease.assignmentId === event.assignmentId &&
        lease.attemptId === event.attemptId &&
        lease.leaseEpoch === event.leaseEpoch &&
        lease.nodeId === sourceNodeId &&
        lease.teamId === event.teamId &&
        ['granted', 'active'].includes(lease.status)
    );
    if (!holdsLease) throw new TypeError('Team membership actor does not hold the active lease');
    return actor;
  };

  function reconcilePeerMessageDeliveries(): void {
    for (const event of eventStore.listAll()) {
      if (event.envelope.type !== 'team.message') continue;
      const parsedPayload = teamMessageEventPayloadSchema.safeParse(event.envelope.payload);
      if (!parsedPayload.success || event.envelope.teamId === undefined) continue;
      const payload = parsedPayload.data;
      const recipientRoute = membershipRouteStore.get(payload.recipientMembershipId);
      if (
        recipientRoute === undefined ||
        recipientRoute.teamId !== event.envelope.teamId ||
        recipientRoute.status !== 'active'
      ) {
        continue;
      }
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
    if (sessions.get(nodeId)?.activeLease !== undefined) return;
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
          ...(session.hello.autoJoinTeamId === undefined
            ? {}
            : { autoJoinTeamId: session.hello.autoJoinTeamId }),
          runtimeCapabilities: session.hello.runtimeCapabilities ?? [],
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
    insecureLanMode,
  }));
  app.get('/ready', async () => ({ ok: true }));
  app.get('/v2/workers', async () => ({
    insecureLanMode,
    workers: listWorkers(),
  }));
  app.get('/v2/commands', async () => ({ commands: commandStore.listAll() }));
  app.get('/v2/events', async () => ({ events: eventStore.listAll() }));
  app.get('/v2/leases', async () => ({ leases: leaseStore.listAll() }));
  app.get('/v2/membership-routes', async () => ({ routes: membershipRouteStore.listAll() }));
  app.post('/v2/teams/:teamId/members', async (request, reply) => {
    const teamId = teamIdSchema.parse((request.params as { teamId?: unknown }).teamId);
    return reply.code(201).send(joinTeamMember(teamId, request.body));
  });
  app.delete('/v2/teams/:teamId/members/:membershipId', async (request) => {
    const params = request.params as { teamId?: unknown; membershipId?: unknown };
    const teamId = teamIdSchema.parse(params.teamId);
    const membershipId = membershipIdSchema.parse(params.membershipId);
    const body =
      typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body)
        ? request.body
        : {};
    return leaveTeamMember(teamId, { ...body, membershipId });
  });
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
  app.post('/v2/runtime-sessions', async (request, reply) => {
    if (auth === undefined) {
      return reply.code(409).send({ error: 'authenticated_runtime_sessions_required' });
    }
    const requested = runtimeSessionCreateRequestSchema.parse(request.body);
    leaseStore.expireThrough();
    const lease = leaseStore
      .listAll()
      .find(
        (candidate) =>
          candidate.teamId === requested.teamId &&
          candidate.nodeId === requested.nodeId &&
          candidate.assignmentId === requested.assignmentId &&
          candidate.attemptId === requested.attemptId &&
          candidate.leaseEpoch === requested.leaseEpoch &&
          ['granted', 'active'].includes(candidate.status)
      );
    const workerSession = sessions.get(requested.nodeId);
    if (
      lease === undefined ||
      workerSession === undefined ||
      !workerSession.hello.runtimeCapabilities?.includes('events.read')
    ) {
      return reply.code(409).send({ error: 'runtime_lease_not_active' });
    }
    const created = runtimeSessionStore.create(
      { ...requested, leaseId: lease.leaseId },
      lease.expiresAt,
      workerSession.hello.runtimeCapabilities
    );
    workerSession.socket.send(
      JSON.stringify({
        type: 'relay.runtime_control',
        protocolVersion: 2,
        sessionId: created.sessionId,
        scope: created.scope,
        control: {
          controlId: randomUUID(),
          type: 'runtime.snapshot',
          payload: {},
        },
      })
    );
    return reply.code(201).send(created);
  });
  app.get('/v2/runtime-sessions/:sessionId/events', async (request, reply) => {
    try {
      const sessionId = runtimeSessionIdSchema.parse(
        (request.params as { sessionId?: unknown }).sessionId
      );
      const token = bearerValue(request.headers.authorization);
      if (token === undefined) throw new RelayRuntimeSessionAuthorizationError();
      const scope = runtimeSessionStore.authorizeRead(sessionId, token);
      leaseStore.expireThrough();
      const readableLease = leaseStore
        .listAll()
        .some(
          (lease) =>
            lease.assignmentId === scope.assignmentId &&
            lease.attemptId === scope.attemptId &&
            lease.leaseId === scope.leaseId &&
            lease.leaseEpoch === scope.leaseEpoch &&
            lease.nodeId === scope.nodeId &&
            lease.teamId === scope.teamId &&
            ['granted', 'active'].includes(lease.status)
        );
      if (!readableLease) {
        runtimeSessionStore.revokeScope(scope);
        throw new RelayRuntimeSessionAuthorizationError();
      }
      const rawAfter = (request.query as { after?: unknown }).after ?? '0';
      const after = typeof rawAfter === 'string' && /^\d+$/.test(rawAfter) ? Number(rawAfter) : NaN;
      return runtimeSessionStore.listEvents(sessionId, token, after);
    } catch (error) {
      if (error instanceof RelayRuntimeSessionAuthorizationError) {
        return reply.code(401).send({ error: error.code });
      }
      throw error;
    }
  });
  app.post('/v2/runtime-sessions/:sessionId/controls', async (request, reply) => {
    try {
      const sessionId = runtimeSessionIdSchema.parse(
        (request.params as { sessionId?: unknown }).sessionId
      );
      const token = bearerValue(request.headers.authorization);
      if (token === undefined) throw new RelayRuntimeSessionAuthorizationError();
      const control = runtimeControlSchema.parse(request.body);
      const scope = runtimeSessionStore.authorizeControl(sessionId, token, control);
      leaseStore.expireThrough();
      const currentLease = leaseStore
        .listAll()
        .find(
          (lease) =>
            lease.assignmentId === scope.assignmentId &&
            lease.attemptId === scope.attemptId &&
            lease.leaseId === scope.leaseId &&
            lease.leaseEpoch === scope.leaseEpoch &&
            lease.nodeId === scope.nodeId &&
            lease.teamId === scope.teamId &&
            ['granted', 'active'].includes(lease.status)
        );
      const workerSession = sessions.get(scope.nodeId);
      if (currentLease === undefined || workerSession === undefined) {
        runtimeSessionStore.revokeScope(scope);
        return reply.code(409).send({ error: 'runtime_lease_not_active' });
      }
      workerSession.socket.send(
        JSON.stringify({
          type: 'relay.runtime_control',
          protocolVersion: 2,
          sessionId,
          scope,
          control,
        })
      );
      return reply.code(202).send({ accepted: true, controlId: control.controlId });
    } catch (error) {
      if (error instanceof RelayRuntimeSessionAuthorizationError) {
        return reply.code(401).send({ error: error.code });
      }
      throw error;
    }
  });

  app.server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url ?? '/', 'http://relay.local');
    if (requestUrl.pathname !== '/v2/worker-stream') {
      socket.destroy();
      return;
    }
    if (auth !== undefined && !tokenMatches(request.headers.authorization, auth.workerToken)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
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
              insecureLanMode,
              heartbeatIntervalMs,
              connectedAt,
            })
          );
          const currentSession = sessions.get(hello.nodeId);
          if (currentSession !== undefined) {
            sendPendingCommands(currentSession, hello.lastInboundCursor);
          }
          for (const teamId of new Set(
            membershipRouteStore
              .listAll()
              .filter((route) => route.nodeId === hello.nodeId && route.status === 'active')
              .map((route) => route.teamId)
          )) {
            broadcastMembershipSnapshot(teamId);
          }
          activatePendingLeadForNode(hello.nodeId);
          reconcileAdvertisedMembershipForNode(hello.nodeId);
          reactivateActiveMembershipsForNode(hello.nodeId);
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
        if (inputType === 'worker.runtime_event') {
          const message = workerRuntimeEventMessageSchema.parse(input);
          if (message.scope.nodeId !== boundNodeId) {
            socket.close(4008, 'Runtime event node does not match the current session');
            return;
          }
          leaseStore.expireThrough();
          const currentLease = leaseStore
            .listAll()
            .find(
              (lease) =>
                lease.assignmentId === message.scope.assignmentId &&
                lease.attemptId === message.scope.attemptId &&
                lease.leaseId === message.scope.leaseId &&
                lease.leaseEpoch === message.scope.leaseEpoch &&
                lease.nodeId === boundNodeId &&
                lease.teamId === message.scope.teamId &&
                ['granted', 'active'].includes(lease.status)
            );
          if (currentLease === undefined) {
            runtimeSessionStore.revokeScope(message.scope);
            socket.close(4009, 'Runtime event does not match an active execution lease');
            return;
          }
          runtimeSessionStore.acceptEvent(message);
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
          const joinRequest =
            message.envelope.type === 'team.member.join_requested'
              ? teamMemberJoinRequestedPayloadSchema.parse(message.envelope.payload)
              : undefined;
          const leaveRequest =
            message.envelope.type === 'team.member.leave_requested'
              ? teamMemberLeaveRequestedPayloadSchema.parse(message.envelope.payload)
              : undefined;
          if (joinRequest !== undefined) {
            assertAuthorizedMembershipActor(
              message.envelope,
              boundNodeId,
              joinRequest.actorMembershipId
            );
          }
          if (leaveRequest !== undefined) {
            assertAuthorizedMembershipActor(
              message.envelope,
              boundNodeId,
              leaveRequest.actorMembershipId,
              leaveRequest.membershipId
            );
          }
          const existing = eventStore.get(message.envelope.eventId);
          if (
            existing === undefined &&
            message.envelope.sequence !== session.lastEventSequence + 1
          ) {
            socket.close(4006, 'Worker event sequence is not contiguous');
            return;
          }
          if (existing === undefined && joinRequest !== undefined) {
            joinTeamMember(message.envelope.teamId!, {
              targetNodeId: joinRequest.targetNodeId,
              role: 'member',
              ...(joinRequest.title === undefined ? {} : { title: joinRequest.title }),
              ...(joinRequest.description === undefined
                ? {}
                : { description: joinRequest.description }),
            });
          }
          if (existing === undefined && leaveRequest !== undefined) {
            leaveTeamMember(message.envelope.teamId!, {
              membershipId: leaveRequest.membershipId,
              ...(leaveRequest.successorMembershipId === undefined
                ? {}
                : { successorMembershipId: leaveRequest.successorMembershipId }),
              ...(leaveRequest.reason === undefined ? {} : { reason: leaveRequest.reason }),
            });
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
              message.envelope.leaseEpoch !== undefined &&
              state.leaseId !== undefined
            ) {
              leaseStore.markActive(
                message.envelope.assignmentId,
                message.envelope.attemptId,
                message.envelope.leaseEpoch
              );
              session.activeLease = {
                assignmentId: message.envelope.assignmentId,
                attemptId: message.envelope.attemptId,
                leaseId: state.leaseId,
                leaseEpoch: message.envelope.leaseEpoch,
              };
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
            if (session.activeLease?.assignmentId === message.envelope.assignmentId) {
              session.activeLease = undefined;
            }
          }
          activatePendingLeadForNode(boundNodeId);
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
        session.activeLease = heartbeat.activeLease;
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
        reconcileAdvertisedMembershipForNode(boundNodeId);
        if (heartbeat.activeLease === undefined) {
          activatePendingLeadForNode(boundNodeId);
          reactivateActiveMembershipsForNode(boundNodeId);
          maybeGrantNextAssignment(boundNodeId);
        }
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
