// @vitest-environment node

import {
  teamIdSchema,
  workerHelloMessageSchema,
} from '@claude-teams/agent-teams-protocol';
import { describe, expect, it } from 'vitest';

const hello = {
  type: 'worker.hello' as const,
  protocolVersion: 2 as const,
  organizationId: '00000000-0000-4000-8000-000000000001',
  personId: '00000000-0000-4000-8000-000000000002',
  nodeId: '00000000-0000-4000-8000-000000000003',
  workerInstanceId: '00000000-0000-4000-8000-000000000004',
  workerGeneration: 1,
  label: 'Auto-discovered worker',
  lastInboundCursor: 0,
  sentAt: '2026-09-03T08:00:00.000Z',
};

describe('Worker Relay messages', () => {
  it('carries an optional team auto-join advertisement in Worker hello', () => {
    const autoJoinTeamId = teamIdSchema.parse('00000000-0000-4000-8000-000000000005');

    expect(workerHelloMessageSchema.parse({ ...hello, autoJoinTeamId })).toMatchObject({
      autoJoinTeamId,
    });
    expect(workerHelloMessageSchema.parse(hello)).not.toHaveProperty('autoJoinTeamId');
  });

  it('rejects a malformed advertised team identity', () => {
    expect(() => workerHelloMessageSchema.parse({ ...hello, autoJoinTeamId: 'not-a-team' })).toThrow();
  });
});
