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
  readonly stop: () => Promise<void>;
}

export const startAgentTeamsWorker = async (
  options: AgentTeamsWorkerOptions
): Promise<StartedAgentTeamsWorker> => {
  await mkdir(options.dataDir, { recursive: true });
  const inboxStore = new WorkerInboxStore(options.dataDir);
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
        inboxStore.accept(message.cursor, message.envelope);
        updateStatus({ lastInboundCursor: inboxStore.lastInboundCursor() });
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
  connect();

  return {
    ready,
    getStatus: () => status,
    listInboxCommands: () => inboxStore.list(),
    stop: async () => {
      stopped = true;
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
      inboxStore.close();
    },
  };
};
