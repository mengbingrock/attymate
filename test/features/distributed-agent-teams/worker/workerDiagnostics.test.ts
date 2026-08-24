import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import {
  type AgentTeamsWorkerStatus,
  diagnoseAgentTeamsWorker,
  installCodexMcpRegistration,
  startWorkerControlServer,
} from '@claude-teams/agent-teams-worker';

describe('Worker diagnostics', () => {
  it('correlates Codex registration, persisted status, and the live control socket', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'agent-teams-diagnose-'));
    const configPath = join(testDir, 'codex', 'config.toml');
    const statusPath = join(testDir, 'worker-status.json');
    const socketPath = join(testDir, 'control.sock');
    const status: AgentTeamsWorkerStatus = {
      service: 'agent-teams-worker',
      protocolVersion: 2,
      insecureLanMode: true,
      label: 'Diagnostic Worker',
      organizationId: organizationIdSchema.parse('00000000-0000-4000-8000-000000000001'),
      personId: personIdSchema.parse('00000000-0000-4000-8000-000000000002'),
      nodeId: nodeIdSchema.parse('00000000-0000-4000-8000-000000000003'),
      workerInstanceId: workerInstanceIdSchema.parse('00000000-0000-4000-8000-000000000004'),
      workerGeneration: 1,
      relayUrl: 'ws://127.0.0.1:43170/v2/worker-stream',
      state: 'connected',
      lastHeartbeatSequence: 2,
      lastInboundCursor: 0,
      lastAckedOutboxSequence: 0,
      updatedAt: '2026-08-14T20:00:00.000Z',
    };
    await installCodexMcpRegistration(configPath, {
      command: 'agent-teams-worker',
      args: ['control-mcp', '--socket', socketPath],
    });
    await writeFile(statusPath, JSON.stringify(status), 'utf8');
    const control = await startWorkerControlServer(socketPath, {
      getStatus: () => status,
      listInboxCommands: () => [],
      listMessages: () => [],
      markMessageRead: () => {
        throw new Error('No messages in this fixture');
      },
      listAssignments: () => [],
      getAssignment: () => undefined,
      listAssignmentActivity: () => [],
      acceptAssignment: () => {
        throw new Error('No assignments in this fixture');
      },
      rejectAssignment: () => {
        throw new Error('No assignments in this fixture');
      },
      deferAssignment: () => {
        throw new Error('No assignments in this fixture');
      },
    });

    try {
      const report = await diagnoseAgentTeamsWorker({
        codexConfigPath: configPath,
        statusPath,
        controlSocketPath: socketPath,
      });
      expect(report).toMatchObject({
        ok: true,
        codexMcp: { state: { status: 'managed' } },
        persistedStatus: { available: true, status: { nodeId: status.nodeId } },
        controlSocket: { reachable: true, status: { nodeId: status.nodeId } },
      });
    } finally {
      await control.close();
    }

    const stoppedReport = await diagnoseAgentTeamsWorker({
      codexConfigPath: configPath,
      statusPath,
      controlSocketPath: socketPath,
    });
    expect(stoppedReport.ok).toBe(false);
    expect(stoppedReport.controlSocket).toMatchObject({ reachable: false });
  });
});
