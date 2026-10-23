// @vitest-environment node
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import {
  SqliteRequestJournal,
  SqliteTeamsApprovalJournal,
  TeamsApprovalDelivery,
} from '@features/microsoft-teams/main';
import type { TeamsApprovalRecord } from '@features/microsoft-teams/contracts';
import type { DistributedAgentTeamsFeatureFacade } from '@features/distributed-agent-teams/main';
import {
  approvalCard,
  taskApprovalGrant,
} from '@features/microsoft-teams/core/domain/approvalCards';

const binding = {
  tenantId: 'tenant',
  aadObjectId: 'owner',
  teamId: 'team',
  nodeId: 'mac',
  ownedNodes: [{ nodeId: 'windows', label: 'My Windows' }],
};
const target = { ...binding, conversationId: 'private' };
const scope = {
  teamId: 'team',
  nodeId: 'windows',
  assignmentId: 'assignment',
  attemptId: 'attempt',
  leaseEpoch: 1,
};
const value = (): TeamsApprovalRecord => ({
  id: 'opaque-card-id',
  key: 'fingerprint',
  target,
  scope,
  nodeLabel: 'My Windows',
  threadId: 'thread',
  turnId: 'turn',
  appServerGeneration: 7,
  request: {
    id: 42,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 'thread', turnId: 'turn', command: 'write a synthetic test file' },
  },
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  state: 'shown',
});

const appApproval = (): TeamsApprovalRecord => ({
  ...value(),
  request: {
    id: 42,
    method: 'mcpServer/elicitation/request',
    params: {
      threadId: 'thread',
      turnId: 'turn',
      serverName: 'cua_repl',
      mode: 'form',
      message: 'Allow Codex to use Calculator?',
      requestedSchema: { type: 'object', properties: {} },
      _meta: {
        codex_approval_kind: 'mcp_tool_call',
        connector_id: 'computer-use',
        riskLevel: 'low',
        persist: ['session', 'always'],
        tool_params: { app: 'calculator' },
      },
    },
  },
});

const fixture = () => {
  const path = join(mkdtempSync(join(tmpdir(), 'teams-approvals-')), 'journal.sqlite');
  const journal = new SqliteTeamsApprovalJournal(path);
  const conversations = new SqliteRequestJournal(path);
  conversations.rememberConversation(target);
  let controlId: string | undefined;
  const framework = {
    getDebugSnapshot: vi.fn().mockResolvedValue({
      membershipRoutes: [],
      leases: [
        { ...scope, status: 'active', expiresAt: new Date(Date.now() + 60_000).toISOString() },
      ],
    }),
    getRuntimeSession: vi.fn().mockImplementation(() =>
      Promise.resolve({
        sessionId: 'stream',
        nextCursor: 2,
        events: controlId
          ? [{ event: { kind: 'control.result', payload: { controlId, ok: true } } }]
          : [],
        truncated: false,
      })
    ),
    sendRuntimeControl: vi.fn().mockImplementation((input: { control: { controlId: string } }) => {
      controlId = input.control.controlId;
      return Promise.resolve();
    }),
  };
  const send = vi.fn().mockResolvedValue('activity');
  const delivery = new TeamsApprovalDelivery(
    framework as unknown as DistributedAgentTeamsFeatureFacade,
    [binding],
    conversations,
    journal,
    send,
    vi.fn()
  );
  return {
    path,
    journal,
    conversations,
    framework,
    delivery,
    send,
    close: () => {
      journal.close();
      conversations.close();
    },
  };
};

describe('Teams device-owner approvals', () => {
  it('reuses a confirmed task grant for the same app, with no second card or global grant', async () => {
    const f = fixture();
    const first = appApproval();
    try {
      f.journal.add(first);
      expect(JSON.stringify(approvalCard(first))).toContain('Allow for this task');
      await f.delivery.resolve(target, first.id, 'accept', { forTask: true });
      expect(f.journal.hasTaskGrant(taskApprovalGrant(first)!.key)).toBe(true);
      const reopened = new SqliteTeamsApprovalJournal(f.path);
      expect(reopened.hasTaskGrant(taskApprovalGrant(first)!.key)).toBe(true);
      reopened.close();
      f.journal.add({
        ...first,
        id: 'next',
        key: 'next',
        state: 'pending',
        request: { ...first.request, id: 43 },
      });
      await f.delivery.tick();
      expect(f.journal.get('next')?.state).toBe('resolved');
      expect(f.send).not.toHaveBeenCalled();
      expect(
        f.framework.sendRuntimeControl.mock.calls.filter(
          ([v]) => (v.control as { type?: string }).type === 'approval.resolve'
        )
      ).toHaveLength(2);
      f.journal.add({
        ...first,
        id: 'new-task',
        key: 'new-task',
        state: 'pending',
        turnId: 'new-turn',
        request: {
          ...first.request,
          id: 44,
          params: { ...first.request.params, turnId: 'new-turn' },
        },
      });
      await f.delivery.tick();
      expect(f.send).toHaveBeenCalledTimes(1);
      expect(f.journal.get('new-task')?.state).toBe('shown');
    } finally {
      f.close();
    }
  });

  it.each(['accept', 'decline'] as const)(
    'does not create a task grant for an ordinary %s click',
    async (decision) => {
      const f = fixture();
      const first = appApproval();
      try {
        f.journal.add(first);
        await f.delivery.resolve(target, first.id, decision);
        expect(f.journal.hasTaskGrant(taskApprovalGrant(first)!.key)).toBe(false);
      } finally {
        f.close();
      }
    }
  );

  it('confirms a delayed receipt in the background once, without replaying approval', async () => {
    const f = fixture();
    const first = appApproval();
    f.framework.getRuntimeSession.mockResolvedValue({
      sessionId: 'stream',
      nextCursor: 2,
      events: [],
      truncated: false,
    });
    try {
      f.journal.add(first);
      expect(await f.delivery.resolve(target, first.id, 'accept', { forTask: true })).toContain(
        'Waiting'
      );
      const pending = f.journal.get(first.id)!;
      expect(pending.state).toBe('resolving');
      expect(f.journal.hasTaskGrant(taskApprovalGrant(first)!.key)).toBe(false);
      const reopened = new SqliteTeamsApprovalJournal(f.path);
      expect(reopened.get(first.id)?.state).toBe('unknown');
      expect(reopened.get(first.id)?.dispatch?.controlId).toBe(pending.dispatch!.controlId);
      reopened.close();
      expect(await f.delivery.resolve(target, first.id, 'accept')).toContain(
        'Nothing was submitted again'
      );
      f.framework.getRuntimeSession.mockResolvedValue({
        sessionId: 'stream',
        nextCursor: 3,
        truncated: false,
        events: [
          {
            event: {
              kind: 'control.result',
              payload: { controlId: pending.dispatch!.controlId, ok: true },
            },
          },
        ],
      });
      await f.delivery.tick();
      await f.delivery.tick();
      expect(f.journal.get(first.id)?.state).toBe('resolved');
      expect(f.journal.hasTaskGrant(taskApprovalGrant(first)!.key)).toBe(true);
      expect(f.conversations.pending()).toHaveLength(1);
      expect(f.conversations.pending()[0].text).toContain('confirmed delivered');
      expect(
        f.framework.sendRuntimeControl.mock.calls.filter(
          ([v]) => (v.control as { type?: string }).type === 'approval.resolve'
        )
      ).toHaveLength(1);
    } finally {
      f.close();
    }
  });

  it('keeps lost receipt coverage unknown and never creates a grant', async () => {
    const f = fixture();
    const first = appApproval();
    try {
      f.journal.add({
        ...first,
        state: 'unknown',
        dispatch: {
          controlId: 'lost',
          decision: 'accept',
          source: 'owner',
          submittedAt: new Date().toISOString(),
          sessionId: 'old-stream',
          cursor: 2,
          grantKey: taskApprovalGrant(first)!.key,
          receiptPending: true,
        },
      });
      await f.delivery.tick();
      expect(f.journal.get(first.id)?.state).toBe('unknown');
      expect(f.journal.get(first.id)?.dispatch?.coverageLost).toBe(true);
      expect(f.journal.hasTaskGrant(taskApprovalGrant(first)!.key)).toBe(false);
      expect(
        f.framework.sendRuntimeControl.mock.calls.some(
          ([v]) => (v.control as { type?: string }).type === 'approval.resolve'
        )
      ).toBe(false);
    } finally {
      f.close();
    }
  });

  it('separates owners, devices, leases, runtime turns and exact resources', () => {
    const first = appApproval();
    const key = taskApprovalGrant(first)!.key;
    for (const change of [
      { target: { ...target, aadObjectId: 'another-owner' } },
      { target: { ...target, conversationId: 'forwarded' } },
      { scope: { ...scope, nodeId: 'mac' } },
      { scope: { ...scope, leaseEpoch: 2 } },
      { turnId: 'next-task' },
      { appServerGeneration: 8 },
      {
        request: {
          ...first.request,
          params: {
            ...first.request.params,
            _meta: {
              ...(first.request.params._meta as object),
              tool_params: { app: 'another-app' },
            },
          },
        },
      },
    ])
      expect(taskApprovalGrant({ ...first, ...change })!.key).not.toBe(key);
    for (const meta of [
      { ...(first.request.params._meta as object), riskLevel: 'high' },
      { ...(first.request.params._meta as object), codex_request_type: 'approval_request' },
      { ...(first.request.params._meta as object), connector_id: 'unknown' },
    ])
      expect(
        taskApprovalGrant({
          ...first,
          request: { ...first.request, params: { ...first.request.params, _meta: meta } },
        })
      ).toBeUndefined();
    expect(taskApprovalGrant(value())).toBeUndefined();
    expect(
      taskApprovalGrant({
        ...first,
        request: {
          ...first.request,
          params: {
            ...first.request.params,
            requestedSchema: { type: 'object', properties: { recipient: { type: 'string' } } },
          },
        },
      })
    ).toBeUndefined();
  });

  it('keeps transport, app and website grants separate, including different origins', () => {
    const first = appApproval();
    const browser = {
      ...first,
      request: {
        ...first.request,
        params: {
          ...first.request.params,
          _meta: {
            codex_approval_kind: 'mcp_tool_call',
            connector_id: 'browser-use',
            codex_request_type: 'approval_request',
            codex_sensitive_action: true,
            tool_name: 'access_browser_origin',
            tool_params: { origin: 'https://example.com' },
          },
        },
      },
    };
    const transport = {
      ...first,
      request: {
        ...first.request,
        params: {
          ...first.request.params,
          message: 'Allow the cua_repl MCP server to run tool "js"?',
          _meta: {
            codex_approval_kind: 'mcp_tool_call',
            tool_params: { code: 'await cua.getState();' },
          },
        },
      },
    };
    expect(new Set([first, browser, transport].map((v) => taskApprovalGrant(v)!.key)).size).toBe(3);
    const otherOrigin = structuredClone(browser);
    otherOrigin.request.params._meta.tool_params.origin = 'https://example.org';
    expect(taskApprovalGrant(otherOrigin)!.key).not.toBe(taskApprovalGrant(browser)!.key);
  });
  it.each(['unknown', 'shown', 'expired'] as const)(
    'reissues a %s card only after an explicit check confirms the same RPC is still pending',
    async (state) => {
      const f = fixture();
      f.journal.add({ ...value(), state, expiresAt: new Date(Date.now() - 1000).toISOString() });
      f.journal.add({
        ...value(),
        id: 'old-lease',
        key: 'old-lease',
        state: 'unknown',
        scope: { ...scope, assignmentId: 'old-assignment' },
      });
      vi.spyOn(f.delivery, 'tick').mockResolvedValue();
      f.framework.getRuntimeSession.mockImplementation(() => {
        const id = f.framework.sendRuntimeControl.mock.calls.at(-1)?.[0].control.controlId;
        return Promise.resolve({
          sessionId: 'stream',
          nextCursor: 3,
          truncated: false,
          events: id
            ? [
                {
                  event: {
                    kind: 'runtime.snapshot',
                    payload: {
                      binding: { threadId: 'thread', turnId: 'turn', appServerGeneration: 7 },
                    },
                  },
                },
                { event: { kind: 'app-server.request', payload: value().request } },
                { event: { kind: 'control.result', payload: { controlId: id, ok: true } } },
              ]
            : [],
        });
      });
      try {
        expect(await f.delivery.refreshUnknown(target)).toContain('Review the new approval card');
        expect(f.journal.get(value().id)?.state).toBe('expired');
        expect(f.journal.pending()).toHaveLength(1);
        expect(f.journal.get('old-lease')?.state).toBe('expired');
        expect(f.framework.sendRuntimeControl).toHaveBeenCalledWith(
          expect.objectContaining({
            control: expect.objectContaining({ type: 'runtime.snapshot' }),
          })
        );
        expect(f.framework.sendRuntimeControl).toHaveBeenCalledTimes(1);
        // The old expired card is not renewed again while its replacement is pending.
        await f.delivery.refreshUnknown(target);
        expect(f.journal.pending()).toHaveLength(1);
        expect(f.framework.sendRuntimeControl).toHaveBeenCalledTimes(1);
      } finally {
        f.close();
      }
    }
  );
  it('captures native consent once and shows its actual requested action', async () => {
    const f = fixture();
    let loaded = false;
    f.framework.getRuntimeSession.mockImplementation(() => {
      if (!loaded) {
        loaded = true;
        return Promise.resolve({
          sessionId: 'stream',
          nextCursor: 1,
          events: [],
          truncated: false,
        });
      }
      return Promise.resolve({
        sessionId: 'stream',
        nextCursor: 3,
        truncated: false,
        events: [
          { event: { kind: 'runtime.snapshot', payload: { binding: { appServerGeneration: 7 } } } },
          {
            event: {
              kind: 'app-server.request',
              payload: {
                id: 42,
                method: 'mcpServer/elicitation/request',
                params: {
                  threadId: 'thread',
                  turnId: 'turn',
                  mode: 'form',
                  message: 'Allow official Computer Use?',
                  requestedSchema: { type: 'object', properties: {} },
                  _meta: {
                    tool_params: {
                      title: 'Discover browsers and apps',
                      code: 'await cua.getState();',
                    },
                  },
                },
              },
            },
          },
        ],
      });
    });
    try {
      await f.delivery.tick();
      await f.delivery.tick();
      expect(f.send).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(f.send.mock.calls)).toContain('await cua.getState();');
      expect(JSON.stringify(f.send.mock.calls)).toContain('My Windows');
    } finally {
      f.close();
    }
  });
  it('routes an owned Windows approval through the existing scoped control, once', async () => {
    const f = fixture();
    try {
      f.journal.add(value());
      expect(await f.delivery.resolve(target, value().id, 'accept')).toContain('delivered');
      expect(f.framework.sendRuntimeControl).toHaveBeenCalledWith(
        expect.objectContaining({
          session: scope,
          control: expect.objectContaining({
            type: 'approval.resolve',
            payload: {
              approvalRequestId: 42,
              decision: 'accept',
              expectedThreadId: 'thread',
              expectedTurnId: 'turn',
              appServerGeneration: 7,
            },
          }),
        })
      );
      expect(await f.delivery.resolve(target, value().id, 'accept')).toContain('already answered');
      expect(f.framework.sendRuntimeControl).toHaveBeenCalledTimes(1);
    } finally {
      f.close();
    }
  });
  it('rejects another owner and forwarded conversation without dispatching anything', async () => {
    const f = fixture();
    try {
      f.journal.add(value());
      await expect(
        f.delivery.resolve({ ...target, aadObjectId: 'manager' }, value().id, 'accept')
      ).rejects.toThrow('another device owner');
      await expect(
        f.delivery.resolve({ ...target, conversationId: 'forwarded' }, value().id, 'accept')
      ).rejects.toThrow('another device owner');
      expect(f.framework.sendRuntimeControl).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  });
  it('rejects an expired lease and does not replay an ambiguous resolution after restart', async () => {
    const f = fixture();
    try {
      f.journal.add(value());
      f.framework.getDebugSnapshot.mockResolvedValue({ leases: [] });
      expect(await f.delivery.resolve(target, value().id, 'accept')).toContain('expired');
      expect(f.framework.sendRuntimeControl).not.toHaveBeenCalled();
      f.journal.add({ ...value(), id: 'ambiguous', key: 'different', state: 'resolving' });
      const reopened = new SqliteTeamsApprovalJournal(f.path);
      expect(reopened.get('ambiguous')?.state).toBe('unknown');
      reopened.close();
    } finally {
      f.close();
    }
  });
});
