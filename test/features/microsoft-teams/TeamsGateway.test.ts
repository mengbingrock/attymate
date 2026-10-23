// @vitest-environment node
/* eslint-disable @typescript-eslint/require-await -- Test doubles implement asynchronous runtime ports. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RelayTeamsRuntime,
  SqliteRequestJournal,
  TeamsGateway,
} from '@features/microsoft-teams/main';
import { describe, expect, it, vi } from 'vitest';

import type { DistributedAgentTeamsFeatureFacade } from '@features/distributed-agent-teams/main';
import type { TeamsRequest } from '@features/microsoft-teams/contracts';

const binding = {
  tenantId: 'tenant-a',
  aadObjectId: 'person-a',
  teamId: 'team-a',
  nodeId: 'node-a',
};
const request: TeamsRequest = {
  ...binding,
  channelId: 'msteams',
  requestKey: 'activity-a',
  conversationType: 'personal',
  text: 'Summarize the supplied synthetic activity.',
};
const makeJournal = () =>
  new SqliteRequestJournal(join(mkdtempSync(join(tmpdir(), 'teams-pilot-')), 'requests.sqlite'));

describe('Teams pilot identity and delivery rules', () => {
  it.each([
    { tenantId: 'tenant-b' },
    { aadObjectId: 'person-b' },
    { aadObjectId: '' },
    { conversationType: 'channel' },
    { conversationType: 'groupChat' },
    { channelId: 'emulator' },
  ])(
    'rejects unbound identities and shared conversations before invoking the worker: %o',
    async (change) => {
      const journal = makeJournal();
      const runtime = { status: vi.fn(), exchange: vi.fn() };
      const gateway = new TeamsGateway([binding], runtime, journal);
      try {
        await expect(gateway.handle({ ...request, ...change })).rejects.toThrow();
        expect(runtime.status).not.toHaveBeenCalled();
        expect(runtime.exchange).not.toHaveBeenCalled();
      } finally {
        journal.close();
      }
    }
  );

  it('returns the same result after restart without sending the request twice', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'teams-pilot-')), 'requests.sqlite');
    const runtime = {
      status: vi.fn(),
      exchange: vi
        .fn()
        .mockResolvedValue('Synthetic Matter A has supporting activity; recorded time is unknown.'),
    };
    const firstJournal = new SqliteRequestJournal(path);
    const first = new TeamsGateway([binding], runtime, firstJournal);
    const result = await first.handle(request);
    firstJournal.close();
    const secondJournal = new SqliteRequestJournal(path);
    try {
      const restarted = new TeamsGateway([binding], runtime, secondJournal);
      await expect(restarted.handle(request)).resolves.toBe(result);
      expect(runtime.exchange).toHaveBeenCalledTimes(1);
      expect(runtime.exchange).toHaveBeenCalledWith(binding, request.text);
    } finally {
      secondJournal.close();
    }
  });

  it('does not resubmit a request with unknown delivery after restart', async () => {
    const journal = makeJournal();
    const runtime = { status: vi.fn(), exchange: vi.fn() };
    journal.begin(request.requestKey);
    try {
      const gateway = new TeamsGateway([binding], runtime, journal);
      await expect(gateway.handle(request)).resolves.toContain('already received');
      expect(runtime.exchange).not.toHaveBeenCalled();
    } finally {
      journal.close();
    }
  });

  it('reports offline status without starting work', async () => {
    const journal = makeJournal();
    const runtime = { status: vi.fn().mockResolvedValue('Worker offline.'), exchange: vi.fn() };
    try {
      const gateway = new TeamsGateway([binding], runtime, journal);
      await expect(gateway.handle({ ...request, text: 'status' })).resolves.toBe('Worker offline.');
      expect(runtime.exchange).not.toHaveBeenCalled();
    } finally {
      journal.close();
    }
  });
});

describe('Teams adapter to the existing framework facade', () => {
  it.each([
    { label: 'confirmed active turn', changedTurn: false, acknowledge: true, working: true },
    { label: 'a different turn', changedTurn: true, acknowledge: true, working: false },
    { label: 'unconfirmed dispatch', changedTurn: false, acknowledge: false, working: false },
  ])('checks live status after the reply deadline: $label', async (testCase) => {
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const controls: { control: { controlId: string; type: string } }[] = [];
    let reads = 0;
    const notification = (method: string, params: unknown) => ({
      event: { kind: 'app-server.notification', payload: { method, params } },
    });
    const snapshot = (state: string, turnId: string) => ({
      event: {
        kind: 'runtime.snapshot',
        payload: { binding: { state, turnId, threadId: 'thread-a', appServerGeneration: 1 } },
      },
    });
    const confirmed = (controlId: string) => ({
      event: { kind: 'control.result', payload: { controlId, ok: true } },
    });
    const facade = {
      getDebugSnapshot: async () => ({
        membershipRoutes: [{ ...binding, status: 'active' }],
        leases: [
          {
            ...binding,
            assignmentId: 'assignment-a',
            attemptId: 'attempt-a',
            leaseEpoch: 1,
            status: 'active',
            expiresAt: new Date(now + 300_000).toISOString(),
          },
        ],
      }),
      sendRuntimeControl: async (input: (typeof controls)[number]) => {
        controls.push(input);
        return { accepted: true };
      },
      getRuntimeSession: async () => {
        reads += 1;
        let events: unknown[];
        if (reads === 1) events = [snapshot('completed', 'old-turn')];
        else if (reads === 2) {
          events = [
            notification('turn/started', { turn: { id: 'new-turn' } }),
            ...(testCase.acknowledge ? [confirmed(controls[1].control.controlId)] : []),
          ];
          now += 120_001;
        } else {
          events = [
            snapshot('active', testCase.changedTurn ? 'another-turn' : 'new-turn'),
            confirmed(controls.at(-1)!.control.controlId),
          ];
          now += 5000;
        }
        return { truncated: false, nextCursor: reads, events };
      },
    } as unknown as DistributedAgentTeamsFeatureFacade;
    try {
      const response = new RelayTeamsRuntime(facade).exchangeResponse(
        binding,
        'Synthetic request.'
      );
      if (testCase.working)
        await expect(response).resolves.toMatchObject({
          text: expect.stringContaining('still working'),
        });
      else await expect(response).rejects.toThrow('unknown');
      expect(controls.filter((c) => c.control.type === 'turn.start')).toHaveLength(1);
      expect(controls.filter((c) => c.control.type === 'runtime.snapshot')).toHaveLength(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('reads the exact failed attempt from durable events after the lease is revoked', async () => {
    const scope = {
      ...binding,
      assignmentId: 'assignment-a',
      attemptId: 'attempt-a',
      leaseEpoch: 1,
    };
    const sendRuntimeControl = vi.fn().mockResolvedValue({ accepted: true });
    const facade = {
      getDebugSnapshot: vi
        .fn()
        .mockResolvedValueOnce({
          membershipRoutes: [{ ...binding, status: 'active' }],
          events: [],
          leases: [
            { ...scope, status: 'active', expiresAt: new Date(Date.now() + 60_000).toISOString() },
          ],
        })
        .mockResolvedValue({
          events: [
            {
              ...scope,
              sourceNodeId: binding.nodeId,
              cursor: 1,
              type: 'assignment.state_changed',
              payload: { state: 'failed', reason: '429 Too Many Requests' },
            },
          ],
        }),
      sendRuntimeControl,
      getRuntimeSession: vi
        .fn()
        .mockResolvedValueOnce({
          truncated: false,
          nextCursor: 1,
          events: [
            {
              event: {
                kind: 'runtime.snapshot',
                payload: {
                  binding: {
                    state: 'completed',
                    threadId: 'thread-a',
                    appServerGeneration: 1,
                  },
                },
              },
            },
          ],
        })
        .mockRejectedValue(new Error('Relay request failed with HTTP 403')),
    } as unknown as DistributedAgentTeamsFeatureFacade;
    const runtime = new RelayTeamsRuntime(facade);
    await expect(runtime.exchange(binding, 'Synthetic request.')).resolves.toContain('429');
    expect(sendRuntimeControl).toHaveBeenCalledTimes(2);
  });

  it('reports a failed model request in status and rejects new work before dispatch', async () => {
    const sendRuntimeControl = vi.fn();
    const facade = {
      getTopology: async () => ({ workers: [{ ...binding, status: 'connected' }] }),
      getDebugSnapshot: async () => ({
        membershipRoutes: [{ ...binding, status: 'active' }],
        leases: [],
        events: [
          {
            ...binding,
            sourceNodeId: binding.nodeId,
            cursor: 1,
            type: 'assignment.state_changed',
            payload: { state: 'failed', reason: '429 Too Many Requests' },
          },
          {
            ...binding,
            sourceNodeId: 'another-node',
            cursor: 2,
            type: 'assignment.state_changed',
            payload: { state: 'running' },
          },
        ],
      }),
      sendRuntimeControl,
    } as unknown as DistributedAgentTeamsFeatureFacade;
    const runtime = new RelayTeamsRuntime(facade);
    await expect(runtime.status(binding)).resolves.toContain('429');
    await expect(runtime.exchange(binding, 'Synthetic request.')).resolves.toContain(
      'automatic retries are stopped'
    );
    expect(sendRuntimeControl).not.toHaveBeenCalled();
  });

  it('returns a clear model-limit reply when a submitted turn fails', async () => {
    const facade = {
      getDebugSnapshot: async () => ({
        membershipRoutes: [{ ...binding, status: 'active' }],
        events: [],
        leases: [
          {
            ...binding,
            assignmentId: 'assignment-a',
            attemptId: 'attempt-a',
            leaseEpoch: 1,
            status: 'active',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        ],
      }),
      sendRuntimeControl: vi.fn().mockResolvedValue({ accepted: true }),
      getRuntimeSession: vi
        .fn()
        .mockResolvedValueOnce({
          truncated: false,
          nextCursor: 1,
          events: [
            {
              event: {
                kind: 'runtime.snapshot',
                payload: {
                  binding: { state: 'completed', threadId: 'thread-a', appServerGeneration: 1 },
                },
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          truncated: false,
          nextCursor: 3,
          events: [
            {
              event: {
                kind: 'app-server.notification',
                payload: {
                  method: 'turn/started',
                  params: { turn: { id: 'turn-a' } },
                },
              },
            },
            {
              event: {
                kind: 'app-server.notification',
                payload: {
                  method: 'turn/completed',
                  params: {
                    turn: {
                      id: 'turn-a',
                      status: 'failed',
                      error: { message: '429 Too Many Requests' },
                    },
                  },
                },
              },
            },
          ],
        }),
    } as unknown as DistributedAgentTeamsFeatureFacade;
    const runtime = new RelayTeamsRuntime(facade);
    await expect(runtime.exchange(binding, 'Synthetic request.')).resolves.toContain('429');
    expect(facade.sendRuntimeControl).toHaveBeenCalledTimes(2);
  });

  it.each([
    { label: 'phased final answer', phase: 'final_answer', includeFinal: true },
    { label: 'legacy final answer', phase: undefined, includeFinal: true },
    { label: 'commentary without a final answer', phase: undefined, includeFinal: false },
  ])('uses the bound lease and returns only the $label', async ({ phase, includeFinal }) => {
    const controls: Record<string, unknown>[] = [];
    let reads = 0;
    const facade = {
      getDebugSnapshot: async () => ({
        membershipRoutes: [{ ...binding, status: 'active' }],
        leases: [
          {
            ...binding,
            assignmentId: 'assignment-a',
            attemptId: 'attempt-a',
            leaseEpoch: 7,
            status: 'active',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        ],
      }),
      sendRuntimeControl: async (input: Record<string, unknown>) => {
        controls.push(input);
        return { accepted: true };
      },
      getRuntimeSession: async () => {
        reads += 1;
        return reads === 1
          ? {
              truncated: false,
              nextCursor: 1,
              events: [
                {
                  event: {
                    kind: 'runtime.snapshot',
                    payload: {
                      binding: {
                        state: 'completed',
                        threadId: 'thread-a',
                        appServerGeneration: 1,
                        turnId: 'old-turn',
                      },
                    },
                  },
                },
              ],
            }
          : {
              truncated: false,
              nextCursor: 5,
              events: [
                {
                  event: {
                    kind: 'app-server.notification',
                    payload: { method: 'turn/started', params: { turn: { id: 'new-turn' } } },
                  },
                },
                {
                  event: {
                    kind: 'app-server.notification',
                    payload: {
                      method: 'item/agentMessage/delta',
                      params: { turnId: 'old-turn', itemId: 'old-item', delta: 'PRIVATE OLD TEXT' },
                    },
                  },
                },
                {
                  event: {
                    kind: 'app-server.notification',
                    payload: {
                      method: 'item/completed',
                      params: {
                        turnId: 'new-turn',
                        item: {
                          id: 'progress-item',
                          type: 'agentMessage',
                          phase: 'commentary',
                          text: '正在检查。',
                        },
                      },
                    },
                  },
                },
                ...(includeFinal
                  ? [
                      {
                        event: {
                          kind: 'app-server.notification',
                          payload: {
                            method: 'item/completed',
                            params: {
                              turnId: 'new-turn',
                              item: {
                                id: 'new-item',
                                type: 'agentMessage',
                                phase,
                                text: 'Synthetic result.',
                              },
                            },
                          },
                        },
                      },
                    ]
                  : []),
                {
                  event: {
                    kind: 'app-server.notification',
                    payload: {
                      method: 'turn/completed',
                      params: { turn: { id: 'new-turn', status: 'completed' } },
                    },
                  },
                },
              ],
            };
      },
    } as unknown as DistributedAgentTeamsFeatureFacade;
    const runtime = new RelayTeamsRuntime(facade);
    await expect(runtime.exchange(binding, 'Synthetic request.')).resolves.toBe(
      includeFinal
        ? 'Synthetic result.'
        : 'The agent completed its turn without a text reply. Check the desktop session.'
    );
    expect(controls[1]).toMatchObject({
      session: {
        teamId: 'team-a',
        nodeId: 'node-a',
        assignmentId: 'assignment-a',
        attemptId: 'attempt-a',
        leaseEpoch: 7,
      },
      control: {
        type: 'turn.start',
        payload: { threadId: 'thread-a', message: expect.stringContaining('Synthetic request.') },
      },
    });
  });
});
