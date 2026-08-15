import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  eventEnvelopeSchema,
  nodeIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { RelayEventConflictError, RelayEventStore } from '@claude-teams/agent-teams-relay';
import { describe, expect, it } from 'vitest';

describe('RelayEventStore', () => {
  it('deduplicates event IDs and preserves the Worker sequence across restart', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'agent-teams-relay-events-'));
    const nodeId = nodeIdSchema.parse('00000000-0000-4000-8000-000000000001');
    const workerInstanceId = workerInstanceIdSchema.parse('00000000-0000-4000-8000-000000000002');
    const event = eventEnvelopeSchema.parse({
      protocolVersion: 2,
      eventId: '00000000-0000-4000-8000-000000000003',
      sequence: 1,
      occurredAt: '2026-08-14T20:00:00.000Z',
      sourceNodeId: nodeId,
      workerInstanceId,
      assignmentId: '00000000-0000-4000-8000-000000000004',
      type: 'assignment.state_changed',
      payload: { revision: 1, state: 'deferred' },
    });
    let store = new RelayEventStore(dataDir);

    expect(store.accept(event).cursor).toBe(1);
    expect(store.accept(event).cursor).toBe(1);
    expect(() => store.accept({ ...event, payload: { revision: 2 } })).toThrow(
      RelayEventConflictError
    );
    expect(store.lastSequenceForNode(nodeId)).toBe(1);
    store.close();

    store = new RelayEventStore(dataDir);
    try {
      expect(store.listAll()).toHaveLength(1);
      expect(store.lastSequenceForNode(nodeId)).toBe(1);
    } finally {
      store.close();
    }
  });
});
