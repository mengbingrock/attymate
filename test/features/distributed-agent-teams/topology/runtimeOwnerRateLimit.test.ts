// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import { describe, expect, it } from 'vitest';

describe('private runtime authorization rate limits', () => {
  it('bounds failed openings and controls without trusting spoofed client headers or session IDs', async () => {
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: await mkdtemp(join(tmpdir(), 'owner-rate-limit-')),
      auth: {
        managerToken: 'owner-rate-limit-manager-fixture-token',
        workerToken: 'owner-rate-limit-worker-fixture-token',
      },
    });
    try {
      for (let index = 0; index < 61; index++) {
        const response = await fetch(`${relay.httpUrl}/v2/runtime-sessions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': `192.0.2.${index + 1}`,
          },
          body: '{}',
        });
        expect(response.status).toBe(index < 60 ? 400 : 429);
        if (index === 60) expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
      }
      for (let index = 0; index < 121; index++) {
        const response = await fetch(
          `${relay.httpUrl}/v2/runtime-sessions/${randomUUID()}/controls`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-forwarded-for': `198.51.100.${index + 1}`,
            },
            body: '{}',
          }
        );
        expect(response.status).toBe(index < 120 ? 401 : 429);
      }
      // Failed private authorization does not consume the separate team-manager API budget.
      expect(
        (
          await fetch(`${relay.httpUrl}/v2/workers`, {
            headers: { authorization: 'Bearer owner-rate-limit-manager-fixture-token' },
          })
        ).status
      ).toBe(200);
    } finally {
      await relay.close();
    }
  });
});
