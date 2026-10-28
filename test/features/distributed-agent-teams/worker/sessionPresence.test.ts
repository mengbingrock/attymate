// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { projectTeamPresence, SESSION_EXPIRES_MS } from '@claude-teams/agent-teams-protocol';
import { expect, it } from 'vitest';

import { SessionPresence } from '../../../../packages/agent-teams-worker/src/sessionPresence';

it('keeps observation age independent of Worker heartbeats and expires an idle dead bridge', () => {
  let now = 100;
  const registry = new SessionPresence(() => now);
  const connectionId = randomUUID();
  const binding = { teamId: randomUUID(), membershipId: randomUUID(), threadId: randomUUID() };
  registry.attach(connectionId, 'binding', binding);
  expect(registry.snapshot(() => true)).toEqual([]);
  registry.renew(connectionId, 0);
  now += 5_000;
  expect(registry.snapshot(() => true)[0]?.ageMs).toBe(5_000);
  registry.renew(connectionId, 3_000);
  now += 2_000;
  expect(registry.snapshot(() => true)[0]?.ageMs).toBe(5_000);
  now += SESSION_EXPIRES_MS;
  expect(registry.snapshot(() => true)).toEqual([]);
});

it('scopes attachments to live connections and memberships; old closes cannot clear replacements', () => {
  const registry = new SessionPresence(() => 100);
  const a = randomUUID(),
    b = randomUUID();
  const binding = { teamId: randomUUID(), membershipId: randomUUID(), threadId: randomUUID() };
  registry.attach(a, 'binding', binding);
  registry.attach(b, 'binding', binding);
  registry.renew(b, 0);
  registry.detach(a);
  registry.renew(a, 0);
  expect(registry.snapshot(() => true)).toEqual([{ ...binding, connectionId: b, ageMs: 0 }]);
  expect(registry.snapshot(() => false)).toEqual([]);
  registry.detach(b, binding.threadId);
  expect(registry.snapshot(() => true)).toEqual([]);
  registry.attach(b, 'binding', binding);
  registry.renew(b, 0);
  registry.clear();
  registry.renew(b, 0);
  expect(registry.snapshot(() => true)).toEqual([]);
});

it('requires fresh independent evidence and authorization, with conservative legacy status', () => {
  const input = {
    now: 100,
    workerExpiresAt: 200,
    sessionExpiresAt: 150,
    supported: true,
    authorized: true,
  };
  expect(projectTeamPresence(input)).toMatchObject({ online: true, validForMs: 50 });
  expect(projectTeamPresence({ ...input, now: 150 })).toMatchObject({
    online: false,
    computerConnected: true,
  });
  expect(projectTeamPresence({ ...input, now: 200 })).toMatchObject({
    online: false,
    computerConnected: false,
  });
  expect(projectTeamPresence({ ...input, authorized: false }).online).toBe(false);
  expect(projectTeamPresence({ ...input, supported: false })).toMatchObject({
    online: false,
    computerConnected: true,
    state: 'unavailable',
  });
  expect(projectTeamPresence({ ...input, sessionExpiresAt: undefined }).online).toBe(false);
});
