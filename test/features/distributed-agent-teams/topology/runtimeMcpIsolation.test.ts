// @vitest-environment node

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assignmentIdSchema,
  attemptIdSchema,
  commandEnvelopeSchema,
  commandIdSchema,
  leaseIdSchema,
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
  createRuntimeMcpToolDefinitions,
  requestWorkerControl,
  RUNTIME_BRIDGE_TOOL_NAMES,
  startAgentTeamsWorker,
  type WorkerAssignment,
  type WorkerCodexAppServerSession,
  WorkerCodexRuntimeSupervisor,
} from '@claude-teams/agent-teams-worker';
import { describe, expect, it, vi } from 'vitest';

class RuntimeMcpCodexSession implements WorkerCodexAppServerSession {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly notifications = new Set<(notification: CodexAppServerNotification) => void>();
  readonly closeListeners = new Set<(event: CodexAppServerSessionClosed) => void>();

  constructor(
    private readonly options: { readonly leakGlobalServer?: boolean; readonly recovery?: boolean } = {}
  ) {}

  request = async <T>(method: string, params?: unknown): Promise<T> => {
    this.requests.push({ method, params });
    if (method === 'config/read') {
      return {
        config: {
          mcp_servers: {
            github: { enabled: true },
            'agent-teams-control': { enabled: true },
          },
        },
      } as T;
    }
    if (method === 'thread/start') {
      return { thread: { id: '00000000-0000-7000-8000-000000000021' } } as T;
    }
    if (method === 'mcpServerStatus/list') {
      return {
        data: [
          {
            name: 'agent-teams-runtime',
            tools: Object.fromEntries(RUNTIME_BRIDGE_TOOL_NAMES.map((name) => [name, {}])),
          },
          ...(this.options.leakGlobalServer
            ? [{ name: 'github', tools: { issue_write: {} } }]
            : []),
        ],
        nextCursor: null,
      } as T;
    }
    if (method === 'turn/start') {
      return {
        turn: { id: '00000000-0000-7000-8000-000000000022', status: 'inProgress' },
      } as T;
    }
    if (this.options.recovery && (method === 'thread/read' || method === 'thread/resume')) {
      return {
        thread: {
          id: '00000000-0000-7000-8000-000000000021',
          status: { type: 'active', activeFlags: [] },
          turns: [
            {
              id: '00000000-0000-7000-8000-000000000022',
              status: 'inProgress',
              error: null,
            },
          ],
        },
      } as T;
    }
    return {} as T;
  };

  notify = (): void => undefined;

  onNotification = (
    listener: (notification: CodexAppServerNotification) => void
  ): (() => void) => {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  };

  onClose = (listener: (event: CodexAppServerSessionClosed) => void): (() => void) => {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  };

  close = async (): Promise<void> => undefined;

  crash(): void {
    for (const listener of this.closeListeners) {
      listener({ error: new Error('fixture app-server crash') });
    }
  }
}

const ids = {
  organizationId: organizationIdSchema.parse('00000000-0000-4000-8000-000000000001'),
  personId: personIdSchema.parse('00000000-0000-4000-8000-000000000002'),
  nodeId: nodeIdSchema.parse('00000000-0000-4000-8000-000000000003'),
  workerInstanceId: workerInstanceIdSchema.parse('00000000-0000-4000-8000-000000000004'),
  teamId: teamIdSchema.parse('00000000-0000-4000-8000-000000000005'),
  membershipId: membershipIdSchema.parse('00000000-0000-4000-8000-000000000006'),
  workspaceId: workspaceIdSchema.parse('00000000-0000-4000-8000-000000000007'),
  assignmentId: assignmentIdSchema.parse('00000000-0000-4000-8000-000000000008'),
  commandId: commandIdSchema.parse('00000000-0000-4000-8000-000000000009'),
} as const;

describe('assignment-scoped runtime MCP isolation', () => {
  it('injects one tokenized runtime server and durably records authorized tool events', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-runtime-mcp-'));
    const controlSocketPath = join(dataRoot, 'worker', 'control.sock');
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(dataRoot, 'relay'),
      heartbeatIntervalMs: 20,
      leaseDurationMs: 2_000,
    });
    const codex = new RuntimeMcpCodexSession();
    const worker = await startAgentTeamsWorker({
      relayUrl: relay.wsUrl,
      dataDir: join(dataRoot, 'worker'),
      organizationId: ids.organizationId,
      personId: ids.personId,
      nodeId: ids.nodeId,
      workerInstanceId: ids.workerInstanceId,
      workerGeneration: 1,
      label: 'Runtime MCP Worker',
      controlSocketPath,
      leaseSweepIntervalMs: 10,
      codexRuntime: {
        cwd: join(dataRoot, 'workspace'),
        sessionFactory: { open: async () => codex },
        runtimeMcp: {
          command: process.execPath,
          args: ['/fixture/runtimeMcpCli.js', '--socket', controlSocketPath],
        },
      },
    });

    try {
      await worker.ready;
      relay.enqueueCommand(
        commandEnvelopeSchema.parse({
          protocolVersion: 2,
          commandId: ids.commandId,
          sequence: 1,
          teamId: ids.teamId,
          targetNodeId: ids.nodeId,
          assignmentId: ids.assignmentId,
          type: 'assignment.offer',
          payload: {
            assignmentId: ids.assignmentId,
            membershipId: ids.membershipId,
            workspaceId: ids.workspaceId,
            title: 'Exercise the isolated runtime tools',
          },
        })
      );
      await vi.waitFor(() => expect(worker.listAssignments()).toHaveLength(1));
      worker.acceptAssignment({ assignmentId: ids.assignmentId, expectedRevision: 0 });
      await vi.waitFor(() =>
        expect(worker.listAssignments()[0]).toMatchObject({ state: 'running' })
      );

      expect(codex.requests.map(({ method }) => method)).toEqual([
        'config/read',
        'thread/start',
        'mcpServerStatus/list',
        'turn/start',
      ]);
      const threadStart = codex.requests.find(({ method }) => method === 'thread/start');
      const params = threadStart?.params as Record<string, unknown>;
      const config = params.config as Record<string, unknown>;
      const servers = config.mcp_servers as Record<string, Record<string, unknown>>;
      expect(servers.github).toEqual({ enabled: false });
      expect(servers['agent-teams-control']).toEqual({ enabled: false });
      expect(servers['agent-teams-runtime']).toMatchObject({
        enabled: true,
        required: true,
        enabled_tools: RUNTIME_BRIDGE_TOOL_NAMES,
      });
      const token = (servers['agent-teams-runtime']?.env as Record<string, string>)
        .AGENT_TEAMS_RUNTIME_SESSION_TOKEN;
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const runtimeContextTool = createRuntimeMcpToolDefinitions(
        controlSocketPath,
        token
      ).find(({ name }) => name === 'runtime_context');
      const runtimeContextResult = await runtimeContextTool?.execute({});
      const runtimeContext = JSON.parse(runtimeContextResult?.content[0]?.text ?? '{}') as {
        context: Record<string, unknown>;
      };
      expect(runtimeContext.context).toMatchObject({
        profile: 'agent-teams-runtime',
        teamId: ids.teamId,
        membershipId: ids.membershipId,
        assignmentId: ids.assignmentId,
        workspaceId: ids.workspaceId,
        turnId: '00000000-0000-7000-8000-000000000022',
      });

      await requestWorkerControl(controlSocketPath, '/v2/runtime-tools/progress_report', {
        method: 'POST',
        bearerToken: token,
        body: {
          idempotencyKey: 'progress-1',
          arguments: { summary: 'Isolation checks passed', percent: 50 },
        },
      });
      await requestWorkerControl(controlSocketPath, '/v2/runtime-tools/progress_report', {
        method: 'POST',
        bearerToken: token,
        body: {
          idempotencyKey: 'progress-1',
          arguments: { summary: 'Isolation checks passed', percent: 50 },
        },
      });
      const progressEvents = worker
        .listOutboxEvents()
        .filter(({ envelope }) => envelope.type === 'assignment.progress');
      expect(progressEvents).toHaveLength(1);
      expect(progressEvents[0]?.envelope).toMatchObject({
        teamId: ids.teamId,
        assignmentId: ids.assignmentId,
        payload: {
          summary: 'Isolation checks passed',
          membershipId: ids.membershipId,
          workspaceId: ids.workspaceId,
        },
      });

      await expect(
        requestWorkerControl(controlSocketPath, '/v2/runtime-tools/progress_report', {
          method: 'POST',
          bearerToken: 'A'.repeat(43),
          body: { idempotencyKey: 'wrong-token', arguments: { summary: 'Denied' } },
        })
      ).rejects.toThrow('HTTP 401');
      await expect(
        requestWorkerControl(controlSocketPath, '/v2/runtime-tools/progress_report', {
          method: 'POST',
          bearerToken: token,
          body: {
            idempotencyKey: 'spoofed-authority',
            arguments: { summary: 'Denied', leaseEpoch: 99 },
          },
        })
      ).rejects.toThrow('HTTP 400');
    } finally {
      await worker.stop();
      await relay.close();
    }
  });

  it('fails before turn start when the thread inventory contains any global MCP server', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-runtime-mcp-leak-'));
    const codex = new RuntimeMcpCodexSession({ leakGlobalServer: true });
    const supervisor = new WorkerCodexRuntimeSupervisor({
      dataDir: dataRoot,
      cwd: join(dataRoot, 'workspace'),
      sessionFactory: { open: async () => codex },
      runtimeIdentity: {
        organizationId: ids.organizationId,
        personId: ids.personId,
        nodeId: ids.nodeId,
        workerInstanceId: ids.workerInstanceId,
      },
      runtimeMcp: {
        command: process.execPath,
        args: ['/fixture/runtimeMcpCli.js', '--socket', join(dataRoot, 'control.sock')],
      },
    });
    const assignment: WorkerAssignment = {
      assignmentId: ids.assignmentId,
      offerCommandId: ids.commandId,
      teamId: ids.teamId,
      membershipId: ids.membershipId,
      workspaceId: ids.workspaceId,
      targetNodeId: ids.nodeId,
      title: 'Reject leaked global MCP tools',
      state: 'preparing_workspace',
      revision: 3,
      offeredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attemptId: attemptIdSchema.parse('00000000-0000-4000-8000-000000000030'),
      leaseId: leaseIdSchema.parse('00000000-0000-4000-8000-000000000031'),
      leaseEpoch: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    try {
      await expect(supervisor.start(assignment)).rejects.toThrow('leaked servers');
      expect(codex.requests.map(({ method }) => method)).toEqual([
        'config/read',
        'thread/start',
        'mcpServerStatus/list',
      ]);
      expect(supervisor.listBindings()[0]).toMatchObject({ state: 'failed' });
    } finally {
      await supervisor.close();
    }
  });

  it('rotates the runtime token when rejoining an active turn after app-server restart', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-runtime-mcp-recovery-'));
    const firstSession = new RuntimeMcpCodexSession();
    const recoverySession = new RuntimeMcpCodexSession({ recovery: true });
    const sessions = [firstSession, recoverySession];
    const supervisor = new WorkerCodexRuntimeSupervisor({
      dataDir: dataRoot,
      cwd: join(dataRoot, 'workspace'),
      sessionFactory: {
        open: async () => {
          const session = sessions.shift();
          if (session === undefined) throw new Error('Unexpected extra app-server launch');
          return session;
        },
      },
      runtimeIdentity: {
        organizationId: ids.organizationId,
        personId: ids.personId,
        nodeId: ids.nodeId,
        workerInstanceId: ids.workerInstanceId,
      },
      runtimeMcp: {
        command: process.execPath,
        args: ['/fixture/runtimeMcpCli.js', '--socket', join(dataRoot, 'control.sock')],
      },
    });
    const assignment: WorkerAssignment = {
      assignmentId: ids.assignmentId,
      offerCommandId: ids.commandId,
      teamId: ids.teamId,
      membershipId: ids.membershipId,
      workspaceId: ids.workspaceId,
      targetNodeId: ids.nodeId,
      title: 'Rotate credentials while recovering',
      state: 'preparing_workspace',
      revision: 3,
      offeredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attemptId: attemptIdSchema.parse('00000000-0000-4000-8000-000000000040'),
      leaseId: leaseIdSchema.parse('00000000-0000-4000-8000-000000000041'),
      leaseEpoch: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    try {
      await supervisor.start(assignment);
      const firstThreadStart = firstSession.requests.find(
        ({ method }) => method === 'thread/start'
      )?.params as Record<string, unknown>;
      const firstServers = (firstThreadStart.config as Record<string, unknown>)
        .mcp_servers as Record<string, Record<string, unknown>>;
      const firstToken = (firstServers['agent-teams-runtime']?.env as Record<string, string>)
        .AGENT_TEAMS_RUNTIME_SESSION_TOKEN;
      expect(supervisor.authorizeRuntimeSession(firstToken)).toMatchObject({
        attemptId: assignment.attemptId,
      });

      firstSession.crash();

      await vi.waitFor(() => {
        const binding = supervisor.listBindings()[0];
        expect(binding).toMatchObject({ state: 'active', appServerGeneration: 2 });
        expect(binding?.reconciliationState).toBeUndefined();
      });
      expect(recoverySession.requests.map(({ method }) => method)).toEqual([
        'thread/read',
        'config/read',
        'thread/resume',
        'mcpServerStatus/list',
      ]);
      const resume = recoverySession.requests.find(
        ({ method }) => method === 'thread/resume'
      )?.params as Record<string, unknown>;
      const recoveredServers = (resume.config as Record<string, unknown>)
        .mcp_servers as Record<string, Record<string, unknown>>;
      const recoveredToken = (recoveredServers['agent-teams-runtime']?.env as Record<
        string,
        string
      >).AGENT_TEAMS_RUNTIME_SESSION_TOKEN;
      expect(recoveredToken).not.toBe(firstToken);
      expect(() => supervisor.authorizeRuntimeSession(firstToken)).toThrow();
      expect(supervisor.authorizeRuntimeSession(recoveredToken)).toMatchObject({
        turnId: '00000000-0000-7000-8000-000000000022',
      });
      const interrupt = supervisor.interrupt(
        {
          assignmentId: assignment.assignmentId,
          attemptId: assignment.attemptId!,
          leaseId: assignment.leaseId!,
          leaseEpoch: assignment.leaseEpoch!,
        },
        'fixture_fence'
      );
      expect(() => supervisor.authorizeRuntimeSession(recoveredToken)).toThrow();
      await interrupt;
    } finally {
      await supervisor.close();
    }
  });
});
