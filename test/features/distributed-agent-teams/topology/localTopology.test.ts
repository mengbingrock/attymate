import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import { startAgentTeamsWorker } from '@claude-teams/agent-teams-worker';

describe('local distributed topology', () => {
  it('connects two independent headless Workers to one Relay', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'agent-teams-v2-topology-'));
    const organizationId = organizationIdSchema.parse(
      '00000000-0000-4000-8000-000000000001'
    );
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(testDir, 'relay'),
      heartbeatIntervalMs: 20,
      staleAfterMs: 100,
    });
    const workerInputs = [
      {
        label: 'Teammate One',
        personId: '00000000-0000-4000-8000-000000000011',
        nodeId: '00000000-0000-4000-8000-000000000012',
        workerInstanceId: '00000000-0000-4000-8000-000000000013',
      },
      {
        label: 'Teammate Two',
        personId: '00000000-0000-4000-8000-000000000021',
        nodeId: '00000000-0000-4000-8000-000000000022',
        workerInstanceId: '00000000-0000-4000-8000-000000000023',
      },
    ] as const;
    const workers = await Promise.all(
      workerInputs.map((input, index) =>
        startAgentTeamsWorker({
          relayUrl: relay.wsUrl,
          dataDir: join(testDir, `worker-${index + 1}`),
          organizationId,
          personId: personIdSchema.parse(input.personId),
          nodeId: nodeIdSchema.parse(input.nodeId),
          workerInstanceId: workerInstanceIdSchema.parse(input.workerInstanceId),
          workerGeneration: 1,
          label: input.label,
          reconnectDelayMs: 25,
        })
      )
    );

    try {
      await Promise.all(workers.map((worker) => worker.ready));
      await vi.waitFor(() => {
        expect(relay.listWorkers()).toHaveLength(2);
        expect(relay.listWorkers().map((worker) => worker.label)).toEqual([
          'Teammate One',
          'Teammate Two',
        ]);
      });
      await vi.waitFor(() => {
        expect(relay.listWorkers().every((worker) => worker.lastHeartbeatSequence > 0)).toBe(
          true
        );
      });
    } finally {
      await Promise.all(workers.map((worker) => worker.stop()));
      await relay.close();
    }
  });
});
