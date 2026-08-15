import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  commandEnvelopeSchema,
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { RelayCommandConflictError, startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import {
  type AgentTeamsWorkerOptions,
  startAgentTeamsWorker,
  type StartedAgentTeamsWorker,
} from '@claude-teams/agent-teams-worker';

const organizationId = organizationIdSchema.parse('00000000-0000-4000-8000-000000000001');
const personId = personIdSchema.parse('00000000-0000-4000-8000-000000000002');
const nodeId = nodeIdSchema.parse('00000000-0000-4000-8000-000000000003');

const commandFor = (commandId: string, sequence: number) =>
  commandEnvelopeSchema.parse({
    protocolVersion: 2,
    commandId,
    sequence,
    targetNodeId: nodeId,
    type: 'assignment.offer',
    payload: {
      assignmentId: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
      title: `Assignment ${sequence}`,
    },
  });

describe('durable Relay to Worker command delivery', () => {
  it('replays offline commands, deduplicates IDs, and survives Relay restart', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'agent-teams-v2-replay-'));
    const relayDataDir = join(testDir, 'relay');
    const workerDataDir = join(testDir, 'worker');
    let relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: relayDataDir,
      heartbeatIntervalMs: 25,
      staleAfterMs: 125,
    });
    let worker: StartedAgentTeamsWorker | undefined;

    const startWorker = async (workerInstanceId: string): Promise<StartedAgentTeamsWorker> => {
      const options: AgentTeamsWorkerOptions = {
        relayUrl: relay.wsUrl,
        dataDir: workerDataDir,
        organizationId,
        personId,
        nodeId,
        workerInstanceId: workerInstanceIdSchema.parse(workerInstanceId),
        workerGeneration: 1,
        label: 'Durable Teammate',
        reconnectDelayMs: 25,
      };
      const started = await startAgentTeamsWorker(options);
      await started.ready;
      return started;
    };

    const firstCommand = commandFor('00000000-0000-4000-8000-000000000011', 1);
    const secondCommand = commandFor('00000000-0000-4000-8000-000000000012', 2);

    try {
      const firstResponse = await relay.app.inject({
        method: 'POST',
        url: '/v2/commands',
        payload: firstCommand,
      });
      expect(firstResponse.statusCode).toBe(201);
      expect(relay.listCommands()[0]?.status).toBe('pending');

      worker = await startWorker('00000000-0000-4000-8000-000000000021');
      await vi.waitFor(() => {
        expect(worker?.listInboxCommands().map((command) => command.commandId)).toEqual([
          firstCommand.commandId,
        ]);
        expect(relay.listCommands()[0]?.status).toBe('acknowledged');
      });

      await worker.stop();
      worker = undefined;
      const secondRecord = relay.enqueueCommand(secondCommand);
      expect(secondRecord.status).toBe('pending');

      worker = await startWorker('00000000-0000-4000-8000-000000000022');
      await vi.waitFor(() => {
        expect(worker?.listInboxCommands().map((command) => command.commandId)).toEqual([
          firstCommand.commandId,
          secondCommand.commandId,
        ]);
        expect(relay.listCommands()[1]?.status).toBe('acknowledged');
      });

      const duplicate = relay.enqueueCommand(secondCommand);
      expect(duplicate.cursor).toBe(secondRecord.cursor);
      expect(relay.listCommands()).toHaveLength(2);
      expect(() =>
        relay.enqueueCommand({
          ...secondCommand,
          payload: { title: 'Conflicting duplicate' },
        })
      ).toThrow(RelayCommandConflictError);

      await worker.stop();
      worker = undefined;
      await relay.close();

      relay = await startAgentTeamsRelay({
        host: '127.0.0.1',
        port: 0,
        dataDir: relayDataDir,
      });
      expect(relay.listCommands()).toHaveLength(2);
      expect(relay.listCommands().every((command) => command.status === 'acknowledged')).toBe(true);
    } finally {
      await worker?.stop();
      await relay.close();
    }
  });
});
