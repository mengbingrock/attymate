import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assignmentAcceptPayloadSchema,
  relayToWorkerMessageSchema,
  DISTRIBUTED_RUNTIME_CAPABILITIES,
  type RelayRuntimeControlMessage,
  type RuntimeEvent,
  type RuntimeSessionCapability,
  type RuntimeSessionScope,
  type WorkerRuntimeEventMessage,
  type PublicMcpToolName,
  type NodeId,
  type OrganizationId,
  type PersonId,
  type WorkerInstanceId,
} from '@claude-teams/agent-teams-protocol';
import WebSocket from 'ws';

import type { WorkerCodexAppServerSessionFactory } from './codexAppServerClient';
import type { CodexRuntimeMcpLaunchSpec } from './codexRuntimeMcpProfile';
import { WorkerCodexRuntimeSupervisor } from './codexRuntimeSupervisor';
import { authorizeWorkerToolInvocation } from './mcpSessionGateway';
import { parseRuntimeMcpToolArguments } from './runtimeMcpServer';
import { startWorkerControlServer, type StartedWorkerControlServer } from './workerControlServer';
import {
  type AssignmentDeferInput,
  type AssignmentMutationInput,
  WorkerAssignmentStore,
} from './workerAssignmentStore';
import { WorkerInboxStore, type WorkerInboxCommand } from './workerInboxStore';
import {
  WorkerMessageStore,
  type WorkerMessageExecutionScope,
  type WorkerTeamMessage,
} from './workerMessageStore';
import { WorkerOutboxStore, type WorkerOutboxEvent } from './workerOutboxStore';
import type { WorkerRuntimeBinding } from './workerRuntimeStore';
import { WorkspaceFileBroker } from './workspaceFileBroker';

export interface AgentTeamsWorkerOptions {
  readonly relayUrl: string;
  readonly relayToken?: string;
  readonly dataDir: string;
  readonly organizationId: OrganizationId;
  readonly personId: PersonId;
  readonly nodeId: NodeId;
  readonly workerInstanceId: WorkerInstanceId;
  readonly workerGeneration: number;
  readonly label: string;
  readonly controlSocketPath?: string;
  readonly reconnectDelayMs?: number;
  readonly leaseSweepIntervalMs?: number;
  readonly codexRuntime?: {
    readonly cwd: string;
    readonly model?: string;
    readonly sessionFactory: WorkerCodexAppServerSessionFactory;
    readonly runtimeMcp?: CodexRuntimeMcpLaunchSpec;
  };
}

export type WorkerConnectionState =
  | 'starting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'stopped';

export interface AgentTeamsWorkerStatus {
  readonly service: 'agent-teams-worker';
  readonly protocolVersion: 2;
  readonly insecureLanMode: boolean;
  readonly label: string;
  readonly organizationId: OrganizationId;
  readonly personId: PersonId;
  readonly nodeId: NodeId;
  readonly workerInstanceId: WorkerInstanceId;
  readonly workerGeneration: number;
  readonly relayUrl: string;
  readonly state: WorkerConnectionState;
  readonly connectedAt?: string;
  readonly lastHeartbeatAckAt?: string;
  readonly lastHeartbeatSequence: number;
  readonly lastInboundCursor: number;
  readonly lastAckedOutboxSequence: number;
  readonly updatedAt: string;
  readonly runtimeCapabilities: readonly RuntimeSessionCapability[];
}

export interface StartedAgentTeamsWorker {
  readonly ready: Promise<void>;
  readonly getStatus: () => AgentTeamsWorkerStatus;
  readonly listInboxCommands: () => readonly WorkerInboxCommand[];
  readonly listMessages: () => readonly WorkerTeamMessage[];
  readonly markMessageRead: (messageId: string) => WorkerTeamMessage;
  readonly listAssignments: () => ReturnType<WorkerAssignmentStore['list']>;
  readonly listOutboxEvents: () => readonly WorkerOutboxEvent[];
  readonly listRuntimeBindings: () => readonly WorkerRuntimeBinding[];
  readonly acceptAssignment: (
    input: AssignmentMutationInput
  ) => ReturnType<WorkerAssignmentStore['accept']>;
  readonly rejectAssignment: (
    input: AssignmentMutationInput
  ) => ReturnType<WorkerAssignmentStore['reject']>;
  readonly deferAssignment: (
    input: AssignmentDeferInput
  ) => ReturnType<WorkerAssignmentStore['defer']>;
  readonly stop: () => Promise<void>;
}

export const startAgentTeamsWorker = async (
  options: AgentTeamsWorkerOptions
): Promise<StartedAgentTeamsWorker> => {
  await mkdir(options.dataDir, { recursive: true });
  const inboxStore = new WorkerInboxStore(options.dataDir);
  const assignmentStore = new WorkerAssignmentStore(options.dataDir);
  const messageStore = new WorkerMessageStore(options.dataDir);
  const activeMessageScope = (): WorkerMessageExecutionScope | undefined => {
    const identity = assignmentStore.activeLeaseIdentity();
    if (identity === undefined) return undefined;
    const assignment = assignmentStore.get(identity.assignmentId);
    if (
      assignment?.teamId === undefined ||
      assignment.membershipId === undefined ||
      assignment.workspaceId === undefined
    ) {
      return undefined;
    }
    return {
      teamId: assignment.teamId,
      membershipId: assignment.membershipId,
      workspaceId: assignment.workspaceId,
      assignmentId: identity.assignmentId,
      attemptId: identity.attemptId,
      leaseEpoch: identity.leaseEpoch,
    };
  };
  const applyAssignmentCommand = (command: WorkerInboxCommand) => {
    if (command.envelope.type === 'team.message.deliver') {
      messageStore.acceptDelivery(command, activeMessageScope());
      return undefined;
    }
    if (command.envelope.type === 'assignment.lease_grant') {
      const { assignmentId, attemptId, leaseEpoch, expiresAt } = command.envelope;
      if (
        assignmentId === undefined ||
        attemptId === undefined ||
        leaseEpoch === undefined ||
        expiresAt === undefined
      ) {
        throw new Error('Lease grant is missing execution identity');
      }
      const assignment = assignmentStore.grantLease({
        assignmentId,
        attemptId,
        leaseEpoch,
        expiresAt,
        payload: command.envelope.payload,
      });
      const scope = activeMessageScope();
      if (scope !== undefined) messageStore.reconcileActiveScope(scope);
      return assignment;
    }
    if (command.envelope.type === 'assignment.accept') {
      const payload = assignmentAcceptPayloadSchema.parse(command.envelope.payload);
      if (
        command.envelope.assignmentId === undefined ||
        command.envelope.assignmentId !== payload.assignmentId
      ) {
        throw new Error('Assignment accept identity does not match its command envelope');
      }
      return assignmentStore.accept(payload);
    }
    return assignmentStore.projectOffer(command);
  };
  const outboxStore = new WorkerOutboxStore(options.dataDir, {
    nodeId: options.nodeId,
    workerInstanceId: options.workerInstanceId,
  });
  for (const command of inboxStore.list()) {
    try {
      applyAssignmentCommand(command);
    } catch {
      // A malformed historical offer remains visible in raw activity but cannot enter the queue.
    }
  }
  const projectAssignmentActivity = (assignmentId: string): void => {
    const assignment = assignmentStore.get(assignmentId);
    if (assignment === undefined) return;
    for (const activity of assignmentStore.listActivity(assignmentId)) {
      outboxStore.projectAssignmentActivity(assignment, activity);
    }
  };
  for (const assignment of assignmentStore.list()) {
    projectAssignmentActivity(assignment.assignmentId);
  }
  let scheduleMessageDelivery: () => void = () => undefined;
  let emitRuntimeEvent: (event: RuntimeEvent, sessionId?: string) => void = () => undefined;
  const runtimeSupervisor =
    options.codexRuntime === undefined
      ? undefined
      : new WorkerCodexRuntimeSupervisor({
          dataDir: options.dataDir,
          cwd: options.codexRuntime.cwd,
          ...(options.codexRuntime.model === undefined
            ? {}
            : { model: options.codexRuntime.model }),
          sessionFactory: options.codexRuntime.sessionFactory,
          ...(options.codexRuntime.runtimeMcp === undefined
            ? {}
            : {
                runtimeIdentity: {
                  organizationId: options.organizationId,
                  personId: options.personId,
                  nodeId: options.nodeId,
                  workerInstanceId: options.workerInstanceId,
                },
                runtimeMcp: options.codexRuntime.runtimeMcp,
              }),
          onStarted: (binding) => {
            const assignment =
              assignmentStore.markRuntimeRunning(binding) ??
              assignmentStore.markRuntimeContinued(binding);
            if (assignment !== undefined) projectAssignmentActivity(assignment.assignmentId);
            flushPendingEvents();
            emitRuntimeEvent({ kind: 'runtime.snapshot', payload: { binding } });
            scheduleMessageDelivery();
          },
          onRecovered: () => {
            scheduleMessageDelivery();
          },
          onCompleted: (binding) => {
            const assignment = assignmentStore.markRuntimeCompleted(binding);
            if (assignment !== undefined) projectAssignmentActivity(assignment.assignmentId);
            flushPendingEvents();
            emitRuntimeEvent({ kind: 'runtime.snapshot', payload: { binding } });
          },
          onFailed: (binding, error) => {
            const assignment = assignmentStore.markRuntimeFailed(
              binding,
              `codex_runtime_failed: ${error.message}`
            );
            if (assignment !== undefined) projectAssignmentActivity(assignment.assignmentId);
            flushPendingEvents();
          },
          onRuntimeEvent: (_binding, notification) => {
            emitRuntimeEvent({
              kind: 'app-server.notification',
              payload: { method: notification.method, params: notification.params },
            });
          },
          onRuntimeRequest: (_binding, request) => {
            emitRuntimeEvent({
              kind: 'app-server.request',
              payload: { id: request.id, method: request.method, params: request.params },
            });
          },
          canRecover: (binding) => {
            const assignment = assignmentStore.get(binding.assignmentId);
            return (
              assignment?.attemptId === binding.attemptId &&
              assignment.leaseId === binding.leaseId &&
              assignment.leaseEpoch === binding.leaseEpoch &&
              assignment.leaseExpiresAt !== undefined &&
              new Date(assignment.leaseExpiresAt).getTime() > Date.now() &&
              ['preparing_workspace', 'running'].includes(assignment.state)
            );
          },
          onReconciliationRequired: (binding, error) => {
            const assignment = assignmentStore.markRuntimeFailed(
              binding,
              `codex_runtime_needs_reconciliation: ${error.message}`
            );
            if (assignment !== undefined) projectAssignmentActivity(assignment.assignmentId);
            flushPendingEvents();
          },
        });
  const workspaceFileBroker =
    options.codexRuntime === undefined ? undefined : new WorkspaceFileBroker(options.codexRuntime.cwd);
  let controlServer: StartedWorkerControlServer | undefined;
  let socket: WebSocket | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let heartbeatSequence = 0;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let stopped = false;
  let readyResolved = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let status: AgentTeamsWorkerStatus = {
    service: 'agent-teams-worker',
    protocolVersion: 2,
    insecureLanMode: options.relayToken === undefined,
    label: options.label,
    organizationId: options.organizationId,
    personId: options.personId,
    nodeId: options.nodeId,
    workerInstanceId: options.workerInstanceId,
    workerGeneration: options.workerGeneration,
    relayUrl: options.relayUrl,
    state: 'starting',
    lastHeartbeatSequence: 0,
    lastInboundCursor: inboxStore.lastInboundCursor(),
    lastAckedOutboxSequence: outboxStore.lastAcknowledgedSequence(),
    updatedAt: new Date().toISOString(),
    runtimeCapabilities:
      options.codexRuntime === undefined ? [] : [...DISTRIBUTED_RUNTIME_CAPABILITIES],
  };

  const persistStatus = async (): Promise<void> => {
    await writeFile(
      join(options.dataDir, 'worker-status.json'),
      `${JSON.stringify(status, null, 2)}\n`,
      'utf8'
    );
  };

  const updateStatus = (changes: Partial<AgentTeamsWorkerStatus>): void => {
    status = { ...status, ...changes, updatedAt: new Date().toISOString() };
    void persistStatus();
  };

  const clearHeartbeat = (): void => {
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  };

  const sendHeartbeat = (): void => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    heartbeatSequence += 1;
    const activeLease = assignmentStore.activeLeaseIdentity();
    socket.send(
      JSON.stringify({
        type: 'worker.heartbeat',
        protocolVersion: 2,
        sequence: heartbeatSequence,
        sentAt: new Date().toISOString(),
        ...(activeLease === undefined ? {} : { activeLease }),
      })
    );
  };

  const flushPendingEvents = (): void => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    for (const event of outboxStore.listPending()) {
      socket.send(
        JSON.stringify({
          type: 'worker.event',
          protocolVersion: 2,
          envelope: event.envelope,
        })
      );
    }
  };

  const runtimeEventQueue: WorkerRuntimeEventMessage[] = [];
  let runtimeEventSequence = 0;
  const currentRuntimeScope = (): RuntimeSessionScope | undefined => {
    const identity = assignmentStore.activeLeaseIdentity();
    if (identity === undefined) return undefined;
    const assignment = assignmentStore.get(identity.assignmentId);
    const binding = runtimeSupervisor
      ?.listBindings()
      .find(
        (candidate) =>
          candidate.assignmentId === identity.assignmentId &&
          candidate.attemptId === identity.attemptId &&
          candidate.leaseId === identity.leaseId &&
          candidate.leaseEpoch === identity.leaseEpoch &&
          ['active', 'completed'].includes(candidate.state) &&
          candidate.reconciliationState === undefined
      );
    if (assignment?.teamId === undefined || binding === undefined) return undefined;
    return {
      teamId: assignment.teamId,
      nodeId: options.nodeId,
      assignmentId: identity.assignmentId,
      attemptId: identity.attemptId,
      leaseId: identity.leaseId,
      leaseEpoch: identity.leaseEpoch,
    };
  };
  const scopeMatches = (left: RuntimeSessionScope, right: RuntimeSessionScope): boolean =>
    left.teamId === right.teamId &&
    left.nodeId === right.nodeId &&
    left.assignmentId === right.assignmentId &&
    left.attemptId === right.attemptId &&
    left.leaseId === right.leaseId &&
    left.leaseEpoch === right.leaseEpoch;
  const boundedRuntimeEvent = (event: RuntimeEvent): RuntimeEvent => {
    try {
      const serialized = JSON.stringify(event.payload);
      if (Buffer.byteLength(serialized, 'utf8') <= 256 * 1024) return event;
      return {
        kind: event.kind,
        payload: {
          truncated: true,
          preview: serialized.slice(0, 16_000),
          originalBytes: Buffer.byteLength(serialized, 'utf8'),
        },
      };
    } catch {
      return { kind: event.kind, payload: { unavailable: 'non_serializable_payload' } };
    }
  };
  const flushRuntimeEvents = (): void => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    while (runtimeEventQueue.length > 0) {
      socket.send(JSON.stringify(runtimeEventQueue.shift()));
    }
  };
  const emitScopedRuntimeEvent = (
    scope: RuntimeSessionScope,
    event: RuntimeEvent,
    sessionId?: string
  ): void => {
    runtimeEventSequence += 1;
    runtimeEventQueue.push({
      type: 'worker.runtime_event',
      protocolVersion: 2,
      eventId: randomUUID(),
      sequence: runtimeEventSequence,
      scope,
      ...(sessionId === undefined ? {} : { sessionId }),
      occurredAt: new Date().toISOString(),
      event: boundedRuntimeEvent(event),
    });
    if (runtimeEventQueue.length > 500) runtimeEventQueue.splice(0, runtimeEventQueue.length - 500);
    flushRuntimeEvents();
  };
  emitRuntimeEvent = (event, sessionId) => {
    const scope = currentRuntimeScope();
    if (scope !== undefined) emitScopedRuntimeEvent(scope, event, sessionId);
  };

  const handleRuntimeControl = async (message: RelayRuntimeControlMessage): Promise<void> => {
    const scope = currentRuntimeScope();
    if (scope === undefined || !scopeMatches(scope, message.scope) || runtimeSupervisor === undefined) {
      emitScopedRuntimeEvent(
        message.scope,
        {
          kind: 'control.result',
          payload: {
            controlId: message.control.controlId,
            ok: false,
            error: 'The worker runtime scope is no longer active',
          },
        },
        message.sessionId
      );
      return;
    }
    try {
      let result: unknown;
      let fenceReason: string | undefined;
      if (message.control.type === 'runtime.snapshot') {
        result = runtimeSupervisor
          .listBindings()
          .find(
            (binding) =>
              binding.assignmentId === scope.assignmentId &&
              binding.attemptId === scope.attemptId &&
              binding.leaseId === scope.leaseId &&
              binding.leaseEpoch === scope.leaseEpoch
          );
        emitScopedRuntimeEvent(
          scope,
          { kind: 'runtime.snapshot', payload: { binding: result } },
          message.sessionId
        );
        for (const request of runtimeSupervisor.listPendingRequests()) {
          emitScopedRuntimeEvent(
            scope,
            {
              kind: 'app-server.request',
              payload: { id: request.id, method: request.method, params: request.params },
            },
            message.sessionId
          );
        }
      } else if (message.control.type === 'turn.start') {
        const assignment = assignmentStore.get(scope.assignmentId);
        if (assignment?.leaseExpiresAt === undefined) {
          throw new Error('Assignment lease expiry is unavailable');
        }
        result = await runtimeSupervisor.startTurn({
          assignmentId: scope.assignmentId,
          attemptId: scope.attemptId,
          leaseId: scope.leaseId,
          leaseEpoch: scope.leaseEpoch,
          leaseExpiresAt: assignment.leaseExpiresAt,
          ...message.control.payload,
        });
      } else if (message.control.type === 'turn.steer') {
        result = await runtimeSupervisor.steer({
          assignmentId: scope.assignmentId,
          attemptId: scope.attemptId,
          leaseId: scope.leaseId,
          leaseEpoch: scope.leaseEpoch,
          ...message.control.payload,
        });
      } else if (message.control.type === 'turn.interrupt') {
        result = await runtimeSupervisor.interrupt(scope, message.control.payload.reason);
        fenceReason = `remote_${message.control.payload.reason}`;
      } else if (message.control.type === 'approval.resolve') {
        result = runtimeSupervisor.resolveApproval(
          scope,
          message.control.payload.approvalRequestId,
          message.control.payload.decision
        );
      } else if (message.control.type === 'review.start') {
        result = await runtimeSupervisor.startReview(scope, message.control.payload.threadId);
      } else if (message.control.type === 'filesystem.list') {
        if (workspaceFileBroker === undefined) throw new Error('Workspace files are unavailable');
        result = await workspaceFileBroker.list(message.control.payload.path);
      } else if (message.control.type === 'filesystem.read') {
        if (workspaceFileBroker === undefined) throw new Error('Workspace files are unavailable');
        result = await workspaceFileBroker.read(message.control.payload.path);
      } else if (message.control.type === 'filesystem.write') {
        if (workspaceFileBroker === undefined) throw new Error('Workspace files are unavailable');
        result = await workspaceFileBroker.write(
          message.control.payload.path,
          message.control.payload.content,
          message.control.payload.expectedRevision
        );
        emitScopedRuntimeEvent(scope, {
          kind: 'filesystem.changed',
          payload: { path: message.control.payload.path },
        });
      }
      emitScopedRuntimeEvent(
        scope,
        {
          kind: 'control.result',
          payload: { controlId: message.control.controlId, ok: true, result },
        },
        message.sessionId
      );
      if (fenceReason !== undefined) {
        const assignment = assignmentStore.fenceLease(scope, fenceReason);
        if (assignment !== undefined) {
          projectAssignmentActivity(assignment.assignmentId);
          flushPendingEvents();
        }
      }
    } catch (error) {
      emitScopedRuntimeEvent(
        scope,
        {
          kind: 'control.result',
          payload: {
            controlId: message.control.controlId,
            ok: false,
            error: error instanceof Error ? error.message.slice(0, 512) : 'Runtime control failed',
          },
        },
        message.sessionId
      );
    }
  };

  let messageDeliveryPromise: Promise<void> | undefined;
  let messageDeliveryRequested = false;
  const deliverPendingMessages = async (): Promise<void> => {
    if (runtimeSupervisor === undefined || stopped) return;
    const scope = activeMessageScope();
    const leaseIdentity = assignmentStore.activeLeaseIdentity();
    if (scope === undefined || leaseIdentity === undefined) return;
    const binding = runtimeSupervisor
      .listBindings()
      .find(
        (candidate) =>
          candidate.assignmentId === scope.assignmentId &&
          candidate.attemptId === scope.attemptId &&
          candidate.leaseEpoch === scope.leaseEpoch &&
          candidate.state === 'active' &&
          candidate.reconciliationState === undefined
      );
    if (binding?.threadId === undefined || binding.turnId === undefined) return;
    const steerIdentity = {
      threadId: binding.threadId,
      turnId: binding.turnId,
      appServerGeneration: binding.appServerGeneration,
    };
    for (const message of messageStore.reconcileActiveScope(scope)) {
      if (stopped) return;
      const claimed = messageStore.beginSteer(message.messageId, scope, steerIdentity);
      if (claimed === undefined) continue;
      try {
        await runtimeSupervisor.steer({
          ...leaseIdentity,
          threadId: steerIdentity.threadId,
          expectedTurnId: steerIdentity.turnId,
          appServerGeneration: steerIdentity.appServerGeneration,
          message: [
            `Agent Teams peer message from membership ${message.payload.senderMembershipId}:`,
            message.payload.message,
          ].join('\n\n'),
        });
        messageStore.markSteered(message.messageId, steerIdentity);
      } catch (error) {
        messageStore.markSteerFailed(
          message.messageId,
          steerIdentity,
          error instanceof Error ? error.message : 'Codex runtime steer failed'
        );
      }
    }
  };
  scheduleMessageDelivery = () => {
    if (stopped) return;
    if (messageDeliveryPromise !== undefined) {
      messageDeliveryRequested = true;
      return;
    }
    messageDeliveryPromise = deliverPendingMessages().finally(() => {
      messageDeliveryPromise = undefined;
      if (messageDeliveryRequested) {
        messageDeliveryRequested = false;
        scheduleMessageDelivery();
      }
    });
    void messageDeliveryPromise.catch(() => undefined);
  };

  const executeRuntimeTool = (input: {
    readonly token: string;
    readonly toolName: string;
    readonly arguments: Readonly<Record<string, unknown>>;
    readonly idempotencyKey: string;
  }): unknown => {
    if (runtimeSupervisor === undefined) {
      throw Object.assign(new Error('Codex runtime is not enabled'), {
        code: 'RUNTIME_MCP_SESSION_DENIED',
      });
    }
    const context = runtimeSupervisor.authorizeRuntimeSession(input.token);
    const parsedArguments = parseRuntimeMcpToolArguments(input.toolName, input.arguments);
    const invocation = authorizeWorkerToolInvocation(
      context,
      input.toolName,
      parsedArguments
    );
    if (input.toolName === 'runtime_context') return { context: invocation.context };
    const eventTypeByTool: Partial<
      Record<PublicMcpToolName, 'assignment.progress' | 'assignment.result_submitted' | 'team.message'>
    > = {
      progress_report: 'assignment.progress',
      result_submit: 'assignment.result_submitted',
      message_send: 'team.message',
    };
    const eventType = eventTypeByTool[input.toolName as PublicMcpToolName];
    if (eventType === undefined) {
      throw new Error(`Runtime MCP tool ${input.toolName} is not implemented by this Worker`);
    }
    const event = outboxStore.projectRuntimeEvent(context, {
      idempotencyKey: input.idempotencyKey,
      type: eventType,
      payload: invocation.arguments,
    });
    flushPendingEvents();
    return { context: invocation.context, event };
  };

  const acceptAssignment = (input: AssignmentMutationInput) => {
    const assignment = assignmentStore.accept(input);
    projectAssignmentActivity(assignment.assignmentId);
    flushPendingEvents();
    return assignment;
  };

  const rejectAssignment = (input: AssignmentMutationInput) => {
    const assignment = assignmentStore.reject(input);
    projectAssignmentActivity(assignment.assignmentId);
    flushPendingEvents();
    return assignment;
  };

  const deferAssignment = (input: AssignmentDeferInput) => {
    const assignment = assignmentStore.defer(input);
    projectAssignmentActivity(assignment.assignmentId);
    flushPendingEvents();
    return assignment;
  };

  const maybeStartRuntime = (assignmentId: string): void => {
    if (runtimeSupervisor === undefined) return;
    let assignment = assignmentStore.get(assignmentId);
    if (assignment === undefined) return;
    if (assignment.state === 'leased') {
      assignment = assignmentStore.prepareRuntime({
        assignmentId: assignment.assignmentId,
        attemptId: assignment.attemptId!,
        leaseId: assignment.leaseId!,
        leaseEpoch: assignment.leaseEpoch!,
      });
      if (assignment === undefined) return;
      projectAssignmentActivity(assignment.assignmentId);
      flushPendingEvents();
    }
    if (!['preparing_workspace', 'running'].includes(assignment.state)) return;
    void runtimeSupervisor.start(assignment).catch(() => undefined);
  };

  const sweepExpiredLeases = (): void => {
    const activeIdentity = assignmentStore.activeLeaseIdentity();
    for (const assignment of assignmentStore.fenceExpired()) {
      projectAssignmentActivity(assignment.assignmentId);
      if (activeIdentity?.assignmentId === assignment.assignmentId) {
        void runtimeSupervisor?.interrupt(activeIdentity, 'lease_expired');
      }
    }
    flushPendingEvents();
  };

  const connect = (): void => {
    if (stopped) return;
    updateStatus({ state: readyResolved ? 'reconnecting' : 'connecting' });
    socket = new WebSocket(options.relayUrl, {
      ...(options.relayToken === undefined
        ? {}
        : { headers: { authorization: `Bearer ${options.relayToken}` } }),
    });

    socket.on('open', () => {
      socket?.send(
        JSON.stringify({
          type: 'worker.hello',
          protocolVersion: 2,
          organizationId: options.organizationId,
          personId: options.personId,
          nodeId: options.nodeId,
          workerInstanceId: options.workerInstanceId,
          workerGeneration: options.workerGeneration,
          label: options.label,
          runtimeCapabilities:
            options.codexRuntime === undefined ? [] : [...DISTRIBUTED_RUNTIME_CAPABILITIES],
          lastInboundCursor: inboxStore.lastInboundCursor(),
          sentAt: new Date().toISOString(),
        })
      );
    });

    socket.on('message', (data) => {
      const message = relayToWorkerMessageSchema.parse(JSON.parse(data.toString('utf8')));
      if (message.type === 'relay.error') {
        if (!readyResolved) rejectReady(new Error(`${message.code}: ${message.message}`));
        socket?.close(4000, message.code);
        return;
      }
      if (message.type === 'relay.welcome') {
        updateStatus({
          state: 'connected',
          connectedAt: message.connectedAt,
          insecureLanMode: message.insecureLanMode,
        });
        if (!readyResolved) {
          readyResolved = true;
          resolveReady();
        }
        clearHeartbeat();
        sendHeartbeat();
        heartbeatTimer = setInterval(sendHeartbeat, message.heartbeatIntervalMs);
        flushPendingEvents();
        flushRuntimeEvents();
        return;
      }
      if (message.type === 'relay.event_ack') {
        const event = outboxStore.acknowledge(message.eventId, message.sequence);
        updateStatus({ lastAckedOutboxSequence: event.sequence });
        return;
      }
      if (message.type === 'relay.runtime_control') {
        void handleRuntimeControl(message);
        return;
      }
      if (message.type === 'relay.command') {
        if (message.envelope.targetNodeId !== options.nodeId) {
          socket?.send(
            JSON.stringify({
              type: 'worker.command_ack',
              protocolVersion: 2,
              commandId: message.envelope.commandId,
              cursor: message.cursor,
              status: 'rejected',
              receivedAt: new Date().toISOString(),
              error: 'Command target does not match this Worker node',
            })
          );
          return;
        }
        const inboxCommand = inboxStore.accept(message.cursor, message.envelope);
        updateStatus({ lastInboundCursor: inboxStore.lastInboundCursor() });
        try {
          const assignment = applyAssignmentCommand(inboxCommand);
          if (assignment !== undefined) projectAssignmentActivity(assignment.assignmentId);
          if (message.envelope.type === 'team.message.deliver') scheduleMessageDelivery();
        } catch (error) {
          socket?.send(
            JSON.stringify({
              type: 'worker.command_ack',
              protocolVersion: 2,
              commandId: message.envelope.commandId,
              cursor: message.cursor,
              status: 'rejected',
              receivedAt: new Date().toISOString(),
              error:
                error instanceof Error ? error.message.slice(0, 512) : 'Invalid assignment offer',
            })
          );
          return;
        }
        socket?.send(
          JSON.stringify({
            type: 'worker.command_ack',
            protocolVersion: 2,
            commandId: message.envelope.commandId,
            cursor: message.cursor,
            status: 'received',
            receivedAt: new Date().toISOString(),
          })
        );
        flushPendingEvents();
        return;
      }
      if (message.leaseReconciliation.action === 'renewed') {
        const renewed = assignmentStore.renewLease(
          message.leaseReconciliation,
          message.leaseReconciliation.expiresAt
        );
        if (renewed) {
          runtimeSupervisor?.renewRuntimeSession(
            message.leaseReconciliation.attemptId,
            message.leaseReconciliation.expiresAt
          );
        }
        maybeStartRuntime(message.leaseReconciliation.assignmentId);
      } else if (message.leaseReconciliation.action === 'fence') {
        const activeIdentity = assignmentStore.activeLeaseIdentity();
        const assignment = assignmentStore.fenceLease(
          message.leaseReconciliation,
          `relay_${message.leaseReconciliation.reason}`
        );
        if (assignment !== undefined) {
          projectAssignmentActivity(assignment.assignmentId);
          flushPendingEvents();
          if (activeIdentity?.assignmentId === assignment.assignmentId) {
            void runtimeSupervisor?.interrupt(
              activeIdentity,
              `relay_${message.leaseReconciliation.reason}`
            );
          }
        }
      }
      updateStatus({
        lastHeartbeatAckAt: message.receivedAt,
        lastHeartbeatSequence: message.sequence,
      });
    });

    socket.on('close', () => {
      clearHeartbeat();
      if (stopped) return;
      updateStatus({ state: 'reconnecting' });
      reconnectTimer = setTimeout(connect, options.reconnectDelayMs ?? 1_000);
    });

    socket.on('error', (error) => {
      if (!readyResolved && options.reconnectDelayMs === undefined) {
        rejectReady(error);
      }
    });
  };

  await persistStatus();
  if (options.controlSocketPath !== undefined) {
    controlServer = await startWorkerControlServer(options.controlSocketPath, {
      getStatus: () => status,
      listInboxCommands: () => inboxStore.list(),
      listMessages: () => messageStore.listAll(),
      markMessageRead: (messageId) => messageStore.markRead(messageId),
      listAssignments: () => assignmentStore.list(),
      getAssignment: (assignmentId) => assignmentStore.get(assignmentId),
      listAssignmentActivity: (assignmentId) => assignmentStore.listActivity(assignmentId),
      acceptAssignment,
      rejectAssignment,
      deferAssignment,
      executeRuntimeTool,
    });
  }
  sweepExpiredLeases();
  const leaseSweepTimer = setInterval(sweepExpiredLeases, options.leaseSweepIntervalMs ?? 1_000);
  connect();

  return {
    ready,
    getStatus: () => status,
    listInboxCommands: () => inboxStore.list(),
    listMessages: () => messageStore.listAll(),
    markMessageRead: (messageId) => messageStore.markRead(messageId),
    listAssignments: () => assignmentStore.list(),
    listOutboxEvents: () => outboxStore.listAll(),
    listRuntimeBindings: () => runtimeSupervisor?.listBindings() ?? [],
    acceptAssignment,
    rejectAssignment,
    deferAssignment,
    stop: async () => {
      stopped = true;
      const activeIdentity = assignmentStore.activeLeaseIdentity();
      if (activeIdentity !== undefined) {
        const assignment = assignmentStore.fenceLease(activeIdentity, 'worker_shutdown');
        if (assignment !== undefined) {
          projectAssignmentActivity(assignment.assignmentId);
          flushPendingEvents();
        }
        await runtimeSupervisor?.interrupt(activeIdentity, 'worker_shutdown');
      }
      await controlServer?.close();
      clearHeartbeat();
      clearInterval(leaseSweepTimer);
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      if (socket !== undefined && socket.readyState < WebSocket.CLOSING) {
        await new Promise<void>((resolve) => {
          socket?.once('close', () => resolve());
          socket?.close(1000, 'Worker shutting down');
        });
      }
      updateStatus({ state: 'stopped' });
      await persistStatus();
      await runtimeSupervisor?.close();
      await messageDeliveryPromise?.catch(() => undefined);
      assignmentStore.close();
      outboxStore.close();
      messageStore.close();
      inboxStore.close();
    },
  };
};
