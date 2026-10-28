// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  commandEnvelopeSchema,
  membershipIdSchema,
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  teamIdSchema,
  workerInstanceIdSchema,
  workspaceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import {
  type CodexAppServerNotification,
  type CodexAppServerRequest,
  type CodexAppServerSessionClosed,
  requestWorkerControl,
  RUNTIME_BRIDGE_TOOL_NAMES,
  runtimeMcpTokenFileForAttempt,
  startAgentTeamsWorker,
  type WorkerCodexAppServerSession,
} from '@claude-teams/agent-teams-worker';

class InboxCodex implements WorkerCodexAppServerSession {
  requests: { method: string; params: unknown }[] = [];
  notifications = new Set<(event: CodexAppServerNotification) => void>();
  serverRequests = new Set<(event: CodexAppServerRequest) => void>();
  threadId = randomUUID();
  turnId = randomUUID();
  turnCount = 0;
  request = async <T>(method: string, params?: unknown): Promise<T> => {
    this.requests.push({ method, params });
    if (method === 'config/read') return { config: { mcp_servers: {} } } as T;
    if (method === 'thread/start') return { thread: { id: this.threadId } } as T;
    if (method === 'thread/read' || method === 'thread/resume')
      return {
        thread: {
          id: this.threadId,
          status: { type: 'active' },
          turns: [{ id: this.turnId, status: 'inProgress' }],
        },
      } as T;
    if (method === 'mcpServerStatus/list')
      return {
        data: [
          {
            name: 'agent-teams-runtime',
            tools: Object.fromEntries(RUNTIME_BRIDGE_TOOL_NAMES.map((name) => [name, {}])),
          },
        ],
        nextCursor: null,
      } as T;
    if (method === 'turn/start') {
      this.turnCount++;
      this.turnId = randomUUID();
      return { turn: { id: this.turnId, status: 'inProgress' } } as T;
    }
    if (method === 'turn/steer') return { turnId: this.turnId } as T;
    return {} as T;
  };
  notify = () => {};
  onNotification = (listener: (event: CodexAppServerNotification) => void) => {
    this.notifications.add(listener);
    return () => {
      this.notifications.delete(listener);
    };
  };
  onRequest = (listener: (event: CodexAppServerRequest) => void) => {
    this.serverRequests.add(listener);
    return () => {
      this.serverRequests.delete(listener);
    };
  };
  onClose = (_listener: (event: CodexAppServerSessionClosed) => void) => () => {};
  respondToRequest = () => {};
  close = async () => {};
  emit(method: string, params: unknown) {
    for (const listener of this.notifications) listener({ method, params });
  }
}

export const fixture = async (mode: 'inline' | 'mcp-inbox' = 'mcp-inbox') => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-inbox-delivery-'));
  const dataDir = join(root, 'worker');
  const controlSocket = join(dataDir, 'control.sock');
  const teamId = teamIdSchema.parse(randomUUID());
  const nodeId = nodeIdSchema.parse(randomUUID());
  const membershipId = membershipIdSchema.parse(randomUUID());
  const workspaceId = workspaceIdSchema.parse(randomUUID());
  const assignmentId = randomUUID();
  const codex = new InboxCodex();
  const relay = await startAgentTeamsRelay({
    host: '127.0.0.1',
    port: 0,
    dataDir: join(root, 'relay'),
    heartbeatIntervalMs: 20,
    leaseDurationMs: 30_000,
  });
  const options = {
    relayUrl: relay.wsUrl,
    dataDir,
    organizationId: organizationIdSchema.parse(randomUUID()),
    personId: personIdSchema.parse(randomUUID()),
    nodeId,
    workerInstanceId: workerInstanceIdSchema.parse(randomUUID()),
    workerGeneration: 1,
    label: 'Inbox recipient',
    controlSocketPath: controlSocket,
    messageDeliveryMode: mode,
    messageDeliveryRetryIntervalMs: 25,
    codexRuntime: {
      cwd: join(root, 'disposable-workspace'),
      sessionFactory: { open: async () => codex },
      runtimeMcp: {
        command: process.execPath,
        args: ['/fixture/runtimeMcpCli.js', '--socket', controlSocket],
        tokenFile: join(dataDir, 'runtime-session.token'),
      },
    },
  };
  let worker = await startAgentTeamsWorker(options);
  await worker.ready;
  relay.enqueueCommand(
    commandEnvelopeSchema.parse({
      protocolVersion: 2,
      commandId: randomUUID(),
      sequence: 1,
      teamId,
      targetNodeId: nodeId,
      assignmentId,
      type: 'assignment.offer',
      payload: { assignmentId, membershipId, workspaceId, title: 'Read scoped peer inbox' },
    })
  );
  await vi.waitFor(() => expect(worker.listAssignments()).toHaveLength(1));
  worker.acceptAssignment({ assignmentId, expectedRevision: 0 });
  await vi.waitFor(() => expect(worker.listAssignments()[0]?.state).toBe('running'));
  let sequence = 10;
  const send = (message: string, epoch = worker.listAssignments()[0]!.leaseEpoch!) => {
    const assignment = worker.listAssignments()[0]!;
    const messageId = randomUUID();
    const command = commandEnvelopeSchema.parse({
      protocolVersion: 2,
      commandId: randomUUID(),
      sequence: sequence++,
      teamId,
      targetNodeId: nodeId,
      assignmentId,
      attemptId: assignment.attemptId,
      leaseEpoch: epoch,
      type: 'team.message.deliver',
      payload: {
        messageId,
        senderMembershipId: randomUUID(),
        recipientMembershipId: membershipId,
        senderWorkspaceId: randomUUID(),
        recipientWorkspaceId: workspaceId,
        sourceAssignmentId: randomUUID(),
        sourceAttemptId: randomUUID(),
        sourceLeaseEpoch: 1,
        turnId: randomUUID(),
        message,
        sentAt: new Date().toISOString(),
      },
    });
    relay.enqueueCommand(command);
    return { messageId, command };
  };
  type InboxMessage = { messageId: string; text: string; readAt?: string; processedAt?: string };
  function call(name: 'message_list', args?: unknown): Promise<{ messages: InboxMessage[] }>;
  function call(
    name: 'support_request' | 'review_request' | 'message_send',
    args?: unknown,
    idempotencyKey?: string
  ): Promise<{
    event: {
      envelope: {
        type: string;
        payload: { senderMembershipId: string; recipientMembershipId: string; message: string };
      };
    };
  }>;
  function call(
    name: 'message_get' | 'message_ack',
    args?: unknown
  ): Promise<{ message: InboxMessage }>;
  async function call(
    name: string,
    args: unknown = {},
    idempotencyKey: string = randomUUID()
  ): Promise<
    | { messages: InboxMessage[] }
    | { message: InboxMessage }
    | {
        event: {
          envelope: {
            type: string;
            payload: { senderMembershipId: string; recipientMembershipId: string; message: string };
          };
        };
      }
  > {
    return requestWorkerControl(controlSocket, `/v2/runtime-tools/${name}`, {
      method: 'POST',
      bearerToken: (
        await readFile(
          runtimeMcpTokenFileForAttempt(
            join(dataDir, 'runtime-session.token'),
            worker.listAssignments()[0]!.attemptId!
          ),
          'utf8'
        )
      ).trim(),
      body: { idempotencyKey, arguments: args },
    });
  }
  return {
    root,
    teamId,
    membershipId,
    codex,
    options,
    relay,
    send,
    roster: async () => {
      const peer = { membershipId: randomUUID(), nodeId: randomUUID(), workspaceId: randomUUID() };
      const now = new Date().toISOString();
      relay.enqueueCommand(
        commandEnvelopeSchema.parse({
          protocolVersion: 2,
          commandId: randomUUID(),
          sequence: sequence++,
          teamId,
          targetNodeId: nodeId,
          type: 'team.membership.snapshot',
          payload: {
            teamId,
            generatedAt: now,
            members: [
              {
                teamId,
                membershipId,
                nodeId,
                workspaceId,
                label: 'Member',
                role: 'member',
                status: 'active',
                revision: 1,
                joinedAt: now,
                updatedAt: now,
              },
              {
                teamId,
                ...peer,
                label: 'Lead',
                role: 'lead',
                status: 'active',
                revision: 1,
                joinedAt: now,
                updatedAt: now,
              },
            ],
          },
        })
      );
      await vi.waitFor(() => expect(worker.listTeamMemberships()[0]?.members).toHaveLength(2));
      return peer;
    },
    call,
    worker: () => worker,
    restart: async () => {
      await worker.stop();
      worker = await startAgentTeamsWorker({
        ...options,
        workerGeneration: 2,
        workerInstanceId: workerInstanceIdSchema.parse(randomUUID()),
      });
      await worker.ready;
    },
    close: async () => {
      await worker.stop();
      await relay.close();
    },
  };
};
