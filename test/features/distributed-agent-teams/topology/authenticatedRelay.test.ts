// @vitest-environment node

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
import { createDistributedAgentTeamsFeature } from '@features/distributed-agent-teams/main';
import { describe, expect, it, vi } from 'vitest';

const MANAGER_TOKEN = 'manager-token-which-is-long-enough-for-tests';
const WORKER_TOKEN = 'worker-token-which-is-long-enough-for-tests';

describe('Authenticated distributed Relay', () => {
  it('requires separate manager and Worker credentials without exposing them in topology', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-authenticated-relay-'));
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(dataRoot, 'relay'),
      heartbeatIntervalMs: 50,
      auth: {
        managerToken: MANAGER_TOKEN,
        workerToken: WORKER_TOKEN,
      },
    });
    const worker = await startAgentTeamsWorker({
      relayUrl: relay.wsUrl,
      relayToken: WORKER_TOKEN,
      dataDir: join(dataRoot, 'worker'),
      organizationId: organizationIdSchema.parse('11111111-1111-4111-8111-111111111111'),
      personId: personIdSchema.parse('22222222-2222-4222-8222-222222222222'),
      nodeId: nodeIdSchema.parse('33333333-3333-4333-8333-333333333333'),
      workerInstanceId: workerInstanceIdSchema.parse(
        '44444444-4444-4444-8444-444444444444'
      ),
      workerGeneration: 1,
      label: 'Authenticated Worker',
      reconnectDelayMs: 50,
    });

    try {
      await worker.ready;
      await expect(fetch(`${relay.httpUrl}/v2/workers`)).resolves.toMatchObject({ status: 401 });

      const manager = createDistributedAgentTeamsFeature({
        relayUrl: relay.httpUrl,
        managerToken: MANAGER_TOKEN,
      });
      await expect(manager.getTopology()).resolves.toMatchObject({
        degraded: false,
        insecureLanMode: false,
        workers: [{ label: 'Authenticated Worker' }],
      });
      expect(JSON.stringify(await manager.getTopology())).not.toContain(MANAGER_TOKEN);
      expect(JSON.stringify(worker.getStatus())).not.toContain(WORKER_TOKEN);

      const teamId = '55555555-5555-4555-8555-555555555555';
      const joined = await manager.joinTeamMember({
        teamId,
        targetNodeId: '33333333-3333-4333-8333-333333333333',
        title: 'Lead the authenticated team',
      });
      expect(joined.membership).toMatchObject({ teamId, role: 'lead', status: 'active' });
      await vi.waitFor(() =>
        expect(worker.listAssignments()).toEqual([
          expect.objectContaining({ state: 'leased', teamRole: 'lead' }),
        ])
      );
      await expect(manager.getTopology()).resolves.toMatchObject({
        membershipRoutes: [
          expect.objectContaining({ membershipId: joined.membership.membershipId, role: 'lead' }),
        ],
      });

      await manager.leaveTeamMember({
        teamId,
        membershipId: joined.membership.membershipId,
        expectedRevision: joined.membership.revision,
      });
      await vi.waitFor(() =>
        expect(worker.listAssignments()[0]).toMatchObject({ state: 'fenced' })
      );
      await expect(manager.getTopology()).resolves.toMatchObject({
        membershipRoutes: [expect.objectContaining({ status: 'left' })],
      });
    } finally {
      await worker.stop();
      await relay.close();
    }
  });
});
