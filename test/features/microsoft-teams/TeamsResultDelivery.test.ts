// @vitest-environment node
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteRequestJournal, TeamsResultDelivery } from '@features/microsoft-teams/main';
import { describe, expect, it, vi } from 'vitest';

import type { DistributedAgentTeamsFeatureFacade } from '@features/distributed-agent-teams/main';

const binding = { tenantId: 'tenant', aadObjectId: 'owner', teamId: 'team', nodeId: 'mac' };
const target = { ...binding, conversationId: 'private-chat' };
const scope = {
  teamId: 'team',
  nodeId: 'mac',
  assignmentId: 'assignment',
  attemptId: 'attempt',
  leaseEpoch: 1,
};
const key = (turn: string) => JSON.stringify(['team', 'mac', 'assignment', 'attempt', 1, turn]);
const path = () => join(mkdtempSync(join(tmpdir(), 'teams-results-')), 'journal.sqlite');
const notification = (method: string, params: Record<string, unknown>) => ({
  event: { kind: 'app-server.notification', payload: { method, params } },
});
const completed = (turnId: string, phase: string, text: string) =>
  notification('item/completed', {
    turnId,
    item: { id: `${turnId}-${phase}`, type: 'agentMessage', phase, text },
  });

const framework = (pages: unknown[]) => ({
  getDebugSnapshot: vi.fn().mockResolvedValue({
    membershipRoutes: [{ ...binding, status: 'active' }],
    leases: [
      { ...scope, status: 'active', expiresAt: new Date(Date.now() + 60_000).toISOString() },
    ],
  }),
  sendRuntimeControl: vi.fn(),
  ...(() => {
    const getRuntimeSession = vi.fn();
    for (const page of pages) getRuntimeSession.mockResolvedValueOnce(page);
    getRuntimeSession.mockResolvedValue({
      sessionId: 'subscription',
      nextCursor: 10,
      events: [],
      truncated: false,
    });
    return { getRuntimeSession };
  })(),
});
const page = (events: unknown[], nextCursor = 10) => ({
  sessionId: 'subscription',
  nextCursor,
  events,
  truncated: false,
});

describe('Teams completed-result delivery', () => {
  it('pushes a late member-triggered result without another user request, and does not duplicate the immediate reply', async () => {
    const journal = new SqliteRequestJournal(path());
    journal.rememberConversation(target);
    const facade = framework([
      page([], 0),
      page([
        completed('initial', 'final_answer', 'Waiting for the Windows member.'),
        notification('turn/completed', { turn: { id: 'initial', status: 'completed' } }),
        completed('late', 'commentary', '正在检查。'),
        completed('late', 'final_answer', 'The fictional review totals 30 minutes.'),
        notification('turn/completed', { turn: { id: 'late', status: 'completed' } }),
      ]),
    ]);
    journal.enqueue(key('initial'), target, 'Waiting for the Windows member.');
    const send = vi.fn().mockResolvedValue('teams-activity');
    const delivery = new TeamsResultDelivery(
      facade as unknown as DistributedAgentTeamsFeatureFacade,
      [binding],
      journal,
      send,
      vi.fn()
    );
    try {
      await delivery.activate(binding);
      await delivery.tick();
      await delivery.tick();
      expect(send.mock.calls).toEqual([
        [target, 'Waiting for the Windows member.'],
        [target, 'The fictional review totals 30 minutes.'],
      ]);
      expect(facade.sendRuntimeControl).not.toHaveBeenCalled();
    } finally {
      journal.close();
    }
  });

  it('resumes queued delivery after restart, but does not retry an ambiguous send', async () => {
    const database = path();
    const first = new SqliteRequestJournal(database);
    first.rememberConversation(target);
    first.enqueue('pending', target, 'Queued result.');
    first.enqueue('ambiguous', target, 'May already be in Teams.');
    first.claim(first.pending()[1].key);
    first.close();
    const journal = new SqliteRequestJournal(database);
    const send = vi.fn().mockResolvedValue('activity');
    const delivery = new TeamsResultDelivery(
      framework([]) as unknown as DistributedAgentTeamsFeatureFacade,
      [binding],
      journal,
      send,
      vi.fn()
    );
    try {
      await delivery.tick();
      expect(send).toHaveBeenCalledExactlyOnceWith(target, 'Queued result.');
      expect(journal.pending()).toEqual([]);
    } finally {
      journal.close();
    }
  });

  it('does not replay a timed-out Teams send or send a removed owner’s pending result', async () => {
    const journal = new SqliteRequestJournal(path());
    journal.enqueue('valid', target, 'Own result.');
    journal.enqueue('other', { ...target, aadObjectId: 'removed-owner' }, 'Private other result.');
    const send = vi.fn().mockRejectedValue(new Error('HTTP response lost'));
    const delivery = new TeamsResultDelivery(
      framework([]) as unknown as DistributedAgentTeamsFeatureFacade,
      [binding],
      journal,
      send,
      vi.fn()
    );
    try {
      await delivery.tick();
      await delivery.tick();
      expect(send).toHaveBeenCalledExactlyOnceWith(target, 'Own result.');
    } finally {
      journal.close();
    }
  });

  it('does not emit failed turns, commentary-only turns, or history from a replacement subscription', async () => {
    const journal = new SqliteRequestJournal(path());
    journal.rememberConversation(target);
    const facade = framework([
      page([], 0),
      page([
        completed('failed', 'final_answer', 'Incomplete private answer.'),
        notification('turn/completed', { turn: { id: 'failed', status: 'failed' } }),
        completed('commentary', 'commentary', 'Progress only.'),
        notification('turn/completed', { turn: { id: 'commentary', status: 'completed' } }),
      ]),
      { ...page([completed('old', 'final_answer', 'Old answer.')]), sessionId: 'replacement' },
    ]);
    const send = vi.fn();
    const report = vi.fn();
    const delivery = new TeamsResultDelivery(
      facade as unknown as DistributedAgentTeamsFeatureFacade,
      [binding],
      journal,
      send,
      report
    );
    try {
      await delivery.tick();
      await delivery.tick();
      expect(send).not.toHaveBeenCalled();
      expect(report).toHaveBeenCalledOnce();
    } finally {
      journal.close();
    }
  });
});
