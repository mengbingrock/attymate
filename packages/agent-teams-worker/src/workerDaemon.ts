import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  relayToWorkerMessageSchema,
  type NodeId,
  type OrganizationId,
  type PersonId,
  type WorkerInstanceId,
} from '@claude-teams/agent-teams-protocol';
import WebSocket from 'ws';

import { startWorkerControlServer, type StartedWorkerControlServer } from './workerControlServer';
import {
  type AssignmentDeferInput,
  type AssignmentMutationInput,
  WorkerAssignmentStore,
} from './workerAssignmentStore';
import { WorkerInboxStore, type WorkerInboxCommand } from './workerInboxStore';

export interface AgentTeamsWorkerOptions {
  readonly relayUrl: string;
  readonly dataDir: string;
  readonly organizationId: OrganizationId;
  readonly personId: PersonId;
  readonly nodeId: NodeId;
  readonly workerInstanceId: WorkerInstanceId;
  readonly workerGeneration: number;
  readonly label: string;
  readonly controlSocketPath?: string;
  readonly reconnectDelayMs?: number;
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
  readonly insecureLanMode: true;
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
  readonly updatedAt: string;
}

export interface StartedAgentTeamsWorker {
  readonly ready: Promise<void>;
  readonly getStatus: () => AgentTeamsWorkerStatus;
  readonly listInboxCommands: () => readonly WorkerInboxCommand[];
  readonly listAssignments: () => ReturnType<WorkerAssignmentStore['list']>;
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
  for (const command of inboxStore.list()) {
    try {
      assignmentStore.projectOffer(command);
    } catch {
      // A malformed historical offer remains visible in raw activity but cannot enter the queue.
    }
  }
  let controlServer: StartedWorkerControlServer | undefined;
  let socket: WebSocket | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;
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
    insecureLanMode: true,
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
    updatedAt: new Date().toISOString(),
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

  const connect = (): void => {
    if (stopped) return;
    updateStatus({ state: readyResolved ? 'reconnecting' : 'connecting' });
    socket = new WebSocket(options.relayUrl);

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
        updateStatus({ state: 'connected', connectedAt: message.connectedAt });
        if (!readyResolved) {
          readyResolved = true;
          resolveReady();
        }
        clearHeartbeat();
        heartbeatTimer = setInterval(() => {
          const sequence = status.lastHeartbeatSequence + 1;
          socket?.send(
            JSON.stringify({
              type: 'worker.heartbeat',
              protocolVersion: 2,
              sequence,
              sentAt: new Date().toISOString(),
            })
          );
        }, message.heartbeatIntervalMs);
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
          assignmentStore.projectOffer(inboxCommand);
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
        return;
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
      listAssignments: () => assignmentStore.list(),
      getAssignment: (assignmentId) => assignmentStore.get(assignmentId),
      listAssignmentActivity: (assignmentId) => assignmentStore.listActivity(assignmentId),
      acceptAssignment: (input) => assignmentStore.accept(input),
      rejectAssignment: (input) => assignmentStore.reject(input),
      deferAssignment: (input) => assignmentStore.defer(input),
    });
  }
  connect();

  return {
    ready,
    getStatus: () => status,
    listInboxCommands: () => inboxStore.list(),
    listAssignments: () => assignmentStore.list(),
    acceptAssignment: (input) => assignmentStore.accept(input),
    rejectAssignment: (input) => assignmentStore.reject(input),
    deferAssignment: (input) => assignmentStore.defer(input),
    stop: async () => {
      stopped = true;
      await controlServer?.close();
      clearHeartbeat();
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      if (socket !== undefined && socket.readyState < WebSocket.CLOSING) {
        await new Promise<void>((resolve) => {
          socket?.once('close', () => resolve());
          socket?.close(1000, 'Worker shutting down');
        });
      }
      updateStatus({ state: 'stopped' });
      await persistStatus();
      assignmentStore.close();
      inboxStore.close();
    },
  };
};
