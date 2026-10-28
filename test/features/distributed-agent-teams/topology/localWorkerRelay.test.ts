// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
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
import { expect, it, vi } from 'vitest';

import { startLocalWorkerRelay } from '../../../../packages/agent-teams-worker/src/localWorkerRelay';

it('registers and heartbeats a real authenticated Worker through the local relay to the upstream team service', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agt-local-relay-'));
  const token = 'test-worker-token-'.repeat(3);
  const upstream = await startAgentTeamsRelay({
    host: '127.0.0.1',
    port: 0,
    dataDir: join(root, 'aws'),
    heartbeatIntervalMs: 30,
    auth: { managerToken: 'test-manager-token-'.repeat(3), workerToken: token },
  });
  const local = await startLocalWorkerRelay({ upstreamUrl: upstream.wsUrl, token });
  const worker = await startAgentTeamsWorker({
    relayUrl: local.url,
    relayToken: token,
    dataDir: join(root, 'worker'),
    organizationId: organizationIdSchema.parse('00000000-0000-4000-8000-000000000001'),
    personId: personIdSchema.parse('00000000-0000-4000-8000-000000000002'),
    nodeId: nodeIdSchema.parse('00000000-0000-4000-8000-000000000003'),
    workerInstanceId: workerInstanceIdSchema.parse('00000000-0000-4000-8000-000000000004'),
    workerGeneration: 1,
    label: 'Local gateway fixture',
    reconnectDelayMs: 25,
  });
  try {
    await worker.ready;
    expect(worker.getStatus().relayUrl).toBe(local.url);
    expect(worker.getStatus().insecureLanMode).toBe(false);
    await vi.waitFor(() =>
      expect(upstream.listWorkers()[0]?.lastHeartbeatSequence).toBeGreaterThan(1)
    );
    expect(upstream.listWorkers()[0]?.nodeId).toBe(worker.getStatus().nodeId);
  } finally {
    await worker.stop();
    await local.close();
    await upstream.close();
    await rm(root, { recursive: true, force: true });
  }
});
