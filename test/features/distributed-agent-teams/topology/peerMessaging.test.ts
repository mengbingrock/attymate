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
      return {
        turn: { id: '00000000-0000-7000-8000-000000000042', status: 'inProgress' },
      } as T;
    }
    return {} as T;
  };

  notify = (): void => undefined;
  onNotification = (
    _listener: (notification: CodexAppServerNotification) => void
  ): (() => void) => () => undefined;
  onClose = (
    _listener: (event: CodexAppServerSessionClosed) => void
  ): (() => void) => () => undefined;
  close = async (): Promise<void> => undefined;
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
    const recipientDataDir = join(dataRoot, 'recipient');
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(dataRoot, 'relay'),
      heartbeatIntervalMs: 20,
      leaseDurationMs: 2_000,
    });
    const codex = new MessagingCodexSession();
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
      });
      await recipient.ready;
      await vi.waitFor(() => {
        expect(recipient?.listMessages()).toEqual([
          expect.objectContaining({
            teamId,
            assignmentId: senderAssignmentId,
            routingState: 'queued',
            payload: expect.objectContaining({
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
    } finally {
      await recipient?.stop();
      await sender.stop();
      await relay.close();
    }
  });
});
