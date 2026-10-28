// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assignmentIdSchema,
  attemptIdSchema,
  commandIdSchema,
  leaseIdSchema,
  membershipIdSchema,
  nodeIdSchema,
  teamIdSchema,
  workspaceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import {
  type CodexAppServerNotification,
  type CodexAppServerSessionClosed,
  createRuntimeSessionTokenSource,
  RUNTIME_BRIDGE_TOOL_NAMES,
  runtimeMcpTokenFileForAttempt,
  type WorkerAssignment,
  type WorkerCodexAppServerSession,
  WorkerCodexRuntimeSupervisor,
} from '@claude-teams/agent-teams-worker';

class TokenSession implements WorkerCodexAppServerSession {
  readonly configs: Record<string, unknown>[] = [];
  readonly closed = new Set<(event: CodexAppServerSessionClosed) => void>();
  readonly notifications = new Set<(event: CodexAppServerNotification) => void>();
  constructor(
    readonly threadId = randomUUID(),
    readonly turnId = randomUUID()
  ) {}
  request = async <T>(method: string, params?: unknown): Promise<T> => {
    if (method === 'config/read') return { config: {} } as T;
    if (method === 'thread/start' || method === 'thread/resume') {
      this.configs.push((params as { config: Record<string, unknown> }).config);
      return {
        thread: {
          id: this.threadId,
          status: { type: 'active' },
          turns: [{ id: this.turnId, status: 'inProgress' }],
        },
      } as T;
    }
    if (method === 'turn/start') return { turn: { id: this.turnId, status: 'inProgress' } } as T;
    if (method === 'thread/read')
      return {
        thread: { id: this.threadId, turns: [{ id: this.turnId, status: 'inProgress' }] },
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
    return {} as T;
  };
  notify = () => {};
  onNotification = (listener: (event: CodexAppServerNotification) => void) => {
    this.notifications.add(listener);
    return () => {
      this.notifications.delete(listener);
    };
  };
  onClose = (listener: (event: CodexAppServerSessionClosed) => void) => {
    this.closed.add(listener);
    return () => {
      this.closed.delete(listener);
    };
  };
  onRequest = () => () => {};
  respondToRequest = () => {};
  close = async () => {};
  bridgeEnv(): Record<string, string> {
    return (this.configs.at(-1)!.mcp_servers as Record<string, { env: Record<string, string> }>)[
      'agent-teams-runtime'
    ]!.env;
  }
}

const assignment = (): WorkerAssignment => ({
  assignmentId: assignmentIdSchema.parse(randomUUID()),
  offerCommandId: commandIdSchema.parse(randomUUID()),
  teamId: teamIdSchema.parse(randomUUID()),
  membershipId: membershipIdSchema.parse(randomUUID()),
  workspaceId: workspaceIdSchema.parse(randomUUID()),
  targetNodeId: nodeIdSchema.parse(randomUUID()),
  title: 'Disposable token isolation fixture',
  state: 'preparing_workspace',
  revision: 1,
  offeredAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  attemptId: attemptIdSchema.parse(randomUUID()),
  leaseId: leaseIdSchema.parse(randomUUID()),
  leaseEpoch: 1,
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
});
const identity = (value: WorkerAssignment) => ({
  assignmentId: value.assignmentId,
  attemptId: value.attemptId!,
  leaseId: value.leaseId!,
  leaseEpoch: value.leaseEpoch!,
});
const bridgeSource = (env: Record<string, string>) =>
  createRuntimeSessionTokenSource({
    token: env.AGENT_TEAMS_RUNTIME_SESSION_TOKEN,
    tokenFile: env.AGENT_TEAMS_RUNTIME_SESSION_TOKEN_FILE,
  }) as () => string;

const fixture = async (sessions: TokenSession[]) => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-attempt-token-'));
  const base = join(root, 'runtime-session.token');
  await writeFile(base, 'legacy-alias-token');
  const supervisor = new WorkerCodexRuntimeSupervisor({
    dataDir: root,
    cwd: root,
    sessionFactory: { open: async () => sessions.shift()! },
    runtimeIdentity: {
      organizationId: randomUUID(),
      personId: randomUUID(),
      nodeId: randomUUID(),
      workerInstanceId: randomUUID(),
    },
    runtimeMcp: { command: process.execPath, args: ['fixture-only.js'], tokenFile: base },
  });
  return { root, base, supervisor };
};

describe('attempt-scoped runtime MCP token files', () => {
  it('never gives a revoked long-lived bridge the next assignment credentials', async () => {
    const session = new TokenSession();
    const { root, base, supervisor } = await fixture([session]);
    const legacy = bridgeSource({
      AGENT_TEAMS_RUNTIME_SESSION_TOKEN: 'legacy-alias-token',
      AGENT_TEAMS_RUNTIME_SESSION_TOKEN_FILE: base,
    });
    const first = assignment();
    const second = assignment();
    try {
      expect(() => legacy()).toThrow(/empty or unreadable/);
      await supervisor.start(first);
      const firstEnv = session.bridgeEnv();
      const oldBridge = bridgeSource(firstEnv);
      const firstFile = runtimeMcpTokenFileForAttempt(base, first.attemptId!);
      expect(firstEnv.AGENT_TEAMS_RUNTIME_SESSION_TOKEN_FILE).toBe(firstFile);
      const firstToken = oldBridge();
      expect(supervisor.authorizeRuntimeSession(firstToken).attemptId).toBe(first.attemptId);
      await supervisor.interrupt(identity(first), 'fixture fence');
      expect(() => oldBridge()).toThrow(/empty or unreadable/);
      await expect(readFile(firstFile)).rejects.toThrow();
      await supervisor.start(second);
      const secondEnv = session.bridgeEnv();
      const newBridge = bridgeSource(secondEnv);
      const secondFile = runtimeMcpTokenFileForAttempt(base, second.attemptId!);
      expect(secondFile).not.toBe(firstFile);
      expect(secondEnv.AGENT_TEAMS_RUNTIME_SESSION_TOKEN_FILE).toBe(secondFile);
      expect(newBridge()).not.toBe(firstToken);
      expect(supervisor.authorizeRuntimeSession(newBridge()).attemptId).toBe(second.attemptId);
      expect(() => supervisor.authorizeRuntimeSession(firstToken)).toThrow();
      expect(() => oldBridge()).toThrow(/empty or unreadable/);
      expect(() => legacy()).toThrow(/empty or unreadable/);
      await expect(readFile(firstFile)).rejects.toThrow();
      await expect(readFile(base)).rejects.toThrow();
      await supervisor.interrupt(identity(first), 'obsolete fence');
      expect(readFileSync(secondFile, 'utf8')).toBe(newBridge());
      await supervisor.interrupt(identity(second), 'fixture cleanup');
      await expect(readFile(secondFile)).rejects.toThrow();
    } finally {
      await supervisor.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rotates the token at the same path only when recovering the same attempt', async () => {
    const session = new TokenSession();
    const recovery = new TokenSession(session.threadId, session.turnId);
    const { root, base, supervisor } = await fixture([session, recovery]);
    const first = assignment();
    try {
      await supervisor.start(first);
      const source = bridgeSource(session.bridgeEnv());
      const original = source();
      for (const listener of session.closed) listener({ error: new Error('fixture restart') });
      await vi.waitFor(() => {
        expect(supervisor.listBindings()[0]?.appServerGeneration).toBe(2);
        expect(recovery.configs).toHaveLength(1);
        expect(supervisor.listBindings()[0]?.reconciliationState).toBeUndefined();
      });
      expect(recovery.bridgeEnv().AGENT_TEAMS_RUNTIME_SESSION_TOKEN_FILE).toBe(
        runtimeMcpTokenFileForAttempt(base, first.attemptId!)
      );
      expect(source()).not.toBe(original);
      expect(() => supervisor.authorizeRuntimeSession(original)).toThrow();
      expect(supervisor.authorizeRuntimeSession(source()).attemptId).toBe(first.attemptId);
      await expect(readFile(base)).rejects.toThrow();
    } finally {
      await supervisor.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects path-like or non-UUID attempt identities', () => {
    expect(() => runtimeMcpTokenFileForAttempt('/tmp/token', '../other')).toThrow();
    expect(() => runtimeMcpTokenFileForAttempt('/tmp/token', '')).toThrow();
  });
});
