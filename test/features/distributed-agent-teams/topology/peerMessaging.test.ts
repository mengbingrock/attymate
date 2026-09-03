// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
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
  type CodexAppServerSessionClosed,
  requestWorkerControl,
  RUNTIME_BRIDGE_TOOL_NAMES,
  startAgentTeamsWorker,
  type StartedAgentTeamsWorker,
  type WorkerCodexAppServerSession,
} from '@claude-teams/agent-teams-worker';
import { describe, expect, it, vi } from 'vitest';

class MessagingCodexSession implements WorkerCodexAppServerSession {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly notificationListeners = new Set<
    (notification: CodexAppServerNotification) => void
  >();
  private turnStartCount = 0;

  request = async <T>(method: string, params?: unknown): Promise<T> => {
    this.requests.push({ method, params });
    if (method === 'config/read') return { config: { mcp_servers: {} } } as T;
    if (method === 'thread/start') {
      return { thread: { id: '00000000-0000-7000-8000-000000000041' } } as T;
    }
    if (method === 'mcpServerStatus/list') {
      return {
        data: [
          {
            name: 'agent-teams-runtime',
            tools: Object.fromEntries(RUNTIME_BRIDGE_TOOL_NAMES.map((name) => [name, {}])),
          },
        ],
        nextCursor: null,
      } as T;
    }
    if (method === 'turn/start') {
      this.turnStartCount += 1;
      return {
        turn: {
          id:
            this.turnStartCount === 1
              ? '00000000-0000-7000-8000-000000000042'
              : '00000000-0000-7000-8000-000000000043',
          status: 'inProgress',
        },
      } as T;
    }
    if (method === 'turn/steer') {
      return { turnId: '00000000-0000-7000-8000-000000000042' } as T;
    }
    return {} as T;
  };

  notify = (): void => undefined;
  onNotification = (
    listener: (notification: CodexAppServerNotification) => void
  ): (() => void) => {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  };
  onRequest = (): (() => void) => () => undefined;
  respondToRequest = (): void => undefined;
  onClose = (
    _listener: (event: CodexAppServerSessionClosed) => void
  ): (() => void) => () => undefined;
  close = async (): Promise<void> => undefined;

  emit(method: string, params: unknown): void {
    for (const listener of this.notificationListeners) listener({ method, params });
  }
}

describe('durable peer messaging', () => {
  it('routes a runtime-authored message to an offline teammate by membership identity', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-peer-message-'));
    const organizationId = organizationIdSchema.parse(
      '00000000-0000-4000-8000-000000000001'
    );
    const teamId = teamIdSchema.parse('00000000-0000-4000-8000-000000000002');
    const senderNodeId = nodeIdSchema.parse('00000000-0000-4000-8000-000000000003');
    const recipientNodeId = nodeIdSchema.parse('00000000-0000-4000-8000-000000000004');
    const senderMembershipId = membershipIdSchema.parse(
      '00000000-0000-4000-8000-000000000005'
    );
    const recipientMembershipId = membershipIdSchema.parse(
      '00000000-0000-4000-8000-000000000006'
    );
    const senderWorkspaceId = workspaceIdSchema.parse(
      '00000000-0000-4000-8000-000000000007'
    );
    const recipientWorkspaceId = workspaceIdSchema.parse(
      '00000000-0000-4000-8000-000000000008'
    );
    const senderAssignmentId = '00000000-0000-4000-8000-000000000009';
    const recipientAssignmentId = '00000000-0000-4000-8000-000000000010';
    const senderControlSocket = join(dataRoot, 'sender', 'control.sock');
    const recipientControlSocket = join(dataRoot, 'recipient', 'control.sock');
    const recipientDataDir = join(dataRoot, 'recipient');
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(dataRoot, 'relay'),
      heartbeatIntervalMs: 20,
      leaseDurationMs: 2_000,
    });
    const codex = new MessagingCodexSession();
    const recipientCodex = new MessagingCodexSession();
    const sender = await startAgentTeamsWorker({
      relayUrl: relay.wsUrl,
      dataDir: join(dataRoot, 'sender'),
      organizationId,
      personId: personIdSchema.parse('00000000-0000-4000-8000-000000000011'),
      nodeId: senderNodeId,
      workerInstanceId: workerInstanceIdSchema.parse(
        '00000000-0000-4000-8000-000000000012'
      ),
      workerGeneration: 1,
      label: 'Sender',
      controlSocketPath: senderControlSocket,
      codexRuntime: {
        cwd: join(dataRoot, 'sender-workspace'),
        sessionFactory: { open: async () => codex },
        runtimeMcp: {
          command: process.execPath,
          args: ['/fixture/runtimeMcpCli.js', '--socket', senderControlSocket],
        },
      },
    });
    let recipient: StartedAgentTeamsWorker | undefined = await startAgentTeamsWorker({
      relayUrl: relay.wsUrl,
      dataDir: recipientDataDir,
      organizationId,
      personId: personIdSchema.parse('00000000-0000-4000-8000-000000000013'),
      nodeId: recipientNodeId,
      workerInstanceId: workerInstanceIdSchema.parse(
        '00000000-0000-4000-8000-000000000014'
      ),
      workerGeneration: 1,
      label: 'Recipient',
      reconnectDelayMs: 25,
    });

    try {
      await Promise.all([sender.ready, recipient.ready]);
      const offers = [
        {
          commandId: '00000000-0000-4000-8000-000000000015',
          targetNodeId: senderNodeId,
          assignmentId: senderAssignmentId,
          membershipId: senderMembershipId,
          workspaceId: senderWorkspaceId,
          title: 'Send a peer review request',
        },
        {
          commandId: '00000000-0000-4000-8000-000000000016',
          targetNodeId: recipientNodeId,
          assignmentId: recipientAssignmentId,
          membershipId: recipientMembershipId,
          workspaceId: recipientWorkspaceId,
          title: 'Receive peer review requests',
        },
      ] as const;
      offers.forEach((offer, index) =>
        relay.enqueueCommand(
          commandEnvelopeSchema.parse({
            protocolVersion: 2,
            commandId: offer.commandId,
            sequence: index + 1,
            teamId,
            targetNodeId: offer.targetNodeId,
            assignmentId: offer.assignmentId,
            type: 'assignment.offer',
            payload: {
              assignmentId: offer.assignmentId,
              membershipId: offer.membershipId,
              workspaceId: offer.workspaceId,
              title: offer.title,
            },
          })
        )
      );
      await vi.waitFor(() => {
        expect(sender.listAssignments()).toHaveLength(1);
        expect(recipient?.listAssignments()).toHaveLength(1);
        expect(relay.listMembershipRoutes()).toHaveLength(2);
      });

      await recipient.stop();
      recipient = undefined;
      sender.acceptAssignment({ assignmentId: senderAssignmentId, expectedRevision: 0 });
      await vi.waitFor(() =>
        expect(sender.listAssignments()[0]).toMatchObject({ state: 'running' })
      );
      const threadStart = codex.requests.find(({ method }) => method === 'thread/start')
        ?.params as Record<string, unknown>;
      const servers = (threadStart.config as Record<string, unknown>).mcp_servers as Record<
        string,
        Record<string, unknown>
      >;
      const token = (servers['agent-teams-runtime']?.env as Record<string, string>)
        .AGENT_TEAMS_RUNTIME_SESSION_TOKEN;

      await requestWorkerControl(senderControlSocket, '/v2/runtime-tools/message_send', {
        method: 'POST',
        bearerToken: token,
        body: {
          idempotencyKey: 'peer-message-1',
          arguments: {
            recipientMembershipId,
            message: 'Please review the parser boundary.',
          },
        },
      });
      await vi.waitFor(() => {
        expect(relay.listEvents().some(({ envelope }) => envelope.type === 'team.message')).toBe(
          true
        );
        expect(
          relay.listCommands().some(({ envelope }) => envelope.type === 'team.message.deliver')
        ).toBe(true);
      });

      recipient = await startAgentTeamsWorker({
        relayUrl: relay.wsUrl,
        dataDir: recipientDataDir,
        organizationId,
        personId: personIdSchema.parse('00000000-0000-4000-8000-000000000013'),
        nodeId: recipientNodeId,
        workerInstanceId: workerInstanceIdSchema.parse(
          '00000000-0000-4000-8000-000000000017'
        ),
        workerGeneration: 2,
        label: 'Recipient',
        reconnectDelayMs: 25,
        controlSocketPath: recipientControlSocket,
        codexRuntime: {
          cwd: join(dataRoot, 'recipient-workspace'),
          sessionFactory: { open: async () => recipientCodex },
          runtimeMcp: {
            command: process.execPath,
            args: ['/fixture/runtimeMcpCli.js', '--socket', recipientControlSocket],
          },
        },
      });
      await recipient.ready;
      await vi.waitFor(() => {
        expect(recipient?.listMessages()).toEqual([
          expect.objectContaining({
            teamId,
            routingState: 'queued',
            payload: expect.objectContaining({
              sourceAssignmentId: senderAssignmentId,
              senderMembershipId,
              recipientMembershipId,
              recipientWorkspaceId,
              message: 'Please review the parser boundary.',
            }),
          }),
        ]);
        expect(
          relay
            .listCommands()
            .find(({ envelope }) => envelope.type === 'team.message.deliver')?.status
        ).toBe('acknowledged');
      });

      recipient.acceptAssignment({ assignmentId: recipientAssignmentId, expectedRevision: 0 });
      await vi.waitFor(() =>
        expect(recipient?.listAssignments()[0]).toMatchObject({ state: 'running' })
      );
      await requestWorkerControl(senderControlSocket, '/v2/runtime-tools/message_send', {
        method: 'POST',
        bearerToken: token,
        body: {
          idempotencyKey: 'peer-message-2',
          arguments: {
            recipientMembershipId,
            message: 'The follow-up is scoped to your active assignment.',
          },
        },
      });
      await vi.waitFor(() => {
        expect(
          relay.listEvents().filter(({ envelope }) => envelope.type === 'team.message')
        ).toHaveLength(2);
        const deliveries = relay
          .listCommands()
          .filter(({ envelope }) => envelope.type === 'team.message.deliver');
        expect(deliveries).toHaveLength(2);
        expect(deliveries[1]?.status).not.toBe('rejected');
        expect(recipient?.listMessages()).toHaveLength(2);
        expect(recipient?.listMessages()[0]).toMatchObject({
          routingState: 'queued',
          steerState: 'pending',
        });
        expect(recipient?.listMessages()[0]?.readAt).toBeUndefined();
        expect(recipient?.listMessages()[1]).toMatchObject({
          targetAssignmentId: recipientAssignmentId,
          routingState: 'available_active',
          steerState: 'delivered',
          readAt: expect.any(String),
        });
        expect(
          recipientCodex.requests.filter(({ method }) => method === 'turn/steer')
        ).toHaveLength(1);
        expect(
          recipientCodex.requests.find(({ method }) => method === 'turn/steer')?.params
        ).toEqual({
          threadId: '00000000-0000-7000-8000-000000000041',
          input: [
            {
              type: 'text',
              text: [
                `Agent Teams peer message from membership ${senderMembershipId}:`,
                'The follow-up is scoped to your active assignment.',
                `Reply routing: send any response through agent-teams-runtime.message_send with recipientMembershipId ${senderMembershipId}. Plain assistant text stays only in this Worker console and is not delivered to the sender.`,
              ].join('\n\n'),
            },
          ],
          expectedTurnId: '00000000-0000-7000-8000-000000000042',
        });
      });

      recipientCodex.emit('turn/completed', {
        turn: {
          id: '00000000-0000-7000-8000-000000000042',
          status: 'completed',
          items: [],
          error: null,
        },
      });
      await vi.waitFor(() =>
        expect(recipient?.listRuntimeBindings()[0]).toMatchObject({ state: 'completed' })
      );
      await requestWorkerControl(senderControlSocket, '/v2/runtime-tools/message_send', {
        method: 'POST',
        bearerToken: token,
        body: {
          idempotencyKey: 'peer-message-3',
          arguments: {
            recipientMembershipId,
            message: 'Wake up and answer this follow-up.',
          },
        },
      });
      await vi.waitFor(() => {
        expect(recipient?.listMessages()).toHaveLength(3);
        expect(recipient?.listMessages()[2]).toMatchObject({
          routingState: 'available_active',
          steerState: 'delivered',
          readAt: expect.any(String),
        });
        expect(recipient?.listRuntimeBindings()[0]).toMatchObject({
          state: 'active',
          turnId: '00000000-0000-7000-8000-000000000043',
        });
        expect(
          recipientCodex.requests.filter(({ method }) => method === 'turn/steer')
        ).toHaveLength(1);
        expect(
          recipientCodex.requests.filter(({ method }) => method === 'turn/start')
        ).toHaveLength(2);
        expect(
          recipientCodex.requests.filter(({ method }) => method === 'turn/start')[1]?.params
        ).toMatchObject({
          threadId: '00000000-0000-7000-8000-000000000041',
          input: [
            {
              type: 'text',
              text: [
                `Agent Teams peer message from membership ${senderMembershipId}:`,
                'Wake up and answer this follow-up.',
                `Reply routing: send any response through agent-teams-runtime.message_send with recipientMembershipId ${senderMembershipId}. Plain assistant text stays only in this Worker console and is not delivered to the sender.`,
              ].join('\n\n'),
            },
          ],
        });
      });
    } finally {
      await recipient?.stop();
      await sender.stop();
      await relay.close();
    }
  });
});
