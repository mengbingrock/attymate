import {
  type ChildProcessWithoutNullStreams,
  spawn,
} from 'node:child_process';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  commandEnvelopeSchema,
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import {
  type AgentTeamsWorkerStatus,
  createOwnerControlToolDefinitions,
  OWNER_CONTROL_BRIDGE_TOOL_NAMES,
  requestWorkerControl,
  startWorkerControlServer,
  type WorkerAgentContextProjection,
  type WorkerInboxCommand,
} from '@claude-teams/agent-teams-worker';

class TestMcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private stdoutBuffer = '';
  private stderr = '';

  constructor(socketPath: string) {
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    this.child = spawn(
      pnpm,
      [
        'exec',
        'tsx',
        'packages/agent-teams-worker/src/controlMcpCli.ts',
        '--socket',
        socketPath,
      ],
      { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] }
    );
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.handleStdout(chunk));
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
    });
    this.child.once('exit', (code) => {
      if (code === 0 || this.pending.size === 0) return;
      const error = new Error(`MCP bridge exited with code ${code}: ${this.stderr}`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  async initialize(): Promise<unknown> {
    const response = await this.request(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'worker-control-test', version: '1.0.0' },
    });
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
    );
    return response;
  }

  listTools(): Promise<unknown> {
    return this.request(2, 'tools/list', {});
  }

  callTool(name: string): Promise<unknown> {
    return this.request(3, 'tools/call', { name, arguments: {} });
  }

  async close(): Promise<void> {
    this.child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      this.child.once('exit', () => resolve());
      setTimeout(resolve, 1_000).unref();
    });
  }

  private request(id: number, method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for MCP ${method}: ${this.stderr}`));
      }, 15_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
      if (typeof message.id !== 'number') continue;
      const pending = this.pending.get(message.id);
      if (pending === undefined) continue;
      this.pending.delete(message.id);
      if (message.error !== undefined) {
        pending.reject(new Error(JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
    }
  }
}

describe('Worker owner-control bridge', () => {
  it('serves owner projections over a protected local socket and restricted MCP profile', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'agent-teams-control-'));
    const socketPath = join(testDir, 'worker-control.sock');
    const status: AgentTeamsWorkerStatus = {
      service: 'agent-teams-worker',
      protocolVersion: 2,
      insecureLanMode: true,
      label: 'Owner Worker',
      organizationId: organizationIdSchema.parse('00000000-0000-4000-8000-000000000001'),
      personId: personIdSchema.parse('00000000-0000-4000-8000-000000000002'),
      nodeId: nodeIdSchema.parse('00000000-0000-4000-8000-000000000003'),
      workerInstanceId: workerInstanceIdSchema.parse(
        '00000000-0000-4000-8000-000000000004'
      ),
      workerGeneration: 1,
      relayUrl: 'ws://127.0.0.1:43170/v2/worker-stream',
      state: 'connected',
      lastHeartbeatSequence: 5,
      lastInboundCursor: 1,
      updatedAt: '2026-08-14T20:00:00.000Z',
    };
    const envelope = commandEnvelopeSchema.parse({
      protocolVersion: 2,
      commandId: '00000000-0000-4000-8000-000000000005',
      sequence: 1,
      targetNodeId: status.nodeId,
      type: 'assignment.offer',
      payload: { title: 'Review local control bridge' },
    });
    const inbox: readonly WorkerInboxCommand[] = [
      {
        cursor: 1,
        commandId: envelope.commandId,
        envelope,
        receivedAt: '2026-08-14T20:00:01.000Z',
      },
    ];
    const control = await startWorkerControlServer(socketPath, {
      getStatus: () => status,
      listInboxCommands: () => inbox,
    });
    const mcp = new TestMcpClient(socketPath);

    try {
      if (process.platform !== 'win32') {
        expect((await stat(testDir)).mode & 0o777).toBe(0o700);
        expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
      }

      const context = await requestWorkerControl<WorkerAgentContextProjection>(
        socketPath,
        '/v2/agent-context'
      );
      expect(context).toMatchObject({
        profile: 'agent-teams-control',
        personId: status.personId,
        nodeId: status.nodeId,
        insecureLanMode: true,
      });

      const definitions = createOwnerControlToolDefinitions(socketPath);
      expect(definitions.map((definition) => definition.name)).toEqual(
        OWNER_CONTROL_BRIDGE_TOOL_NAMES
      );
      expect(definitions.map((definition) => definition.name)).not.toContain('progress_report');
      expect(definitions.map((definition) => definition.name)).not.toContain('team_launch');

      await mcp.initialize();
      const tools = (await mcp.listTools()) as { tools: Array<{ name: string }> };
      expect(tools.tools.map((tool) => tool.name)).toEqual(OWNER_CONTROL_BRIDGE_TOOL_NAMES);
      const result = (await mcp.callTool('worker_status')) as {
        content: Array<{ text: string }>;
      };
      expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
        service: 'agent-teams-worker',
        nodeId: status.nodeId,
      });
    } finally {
      await mcp.close();
      await control.close();
    }
  });
});
