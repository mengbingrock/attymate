// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { RelayDesktopChats } from '../../../../packages/agent-teams-relay/src/relayDesktopChats';
import { DesktopChatService } from '../../../../packages/agent-teams-worker/src/desktopChatService';
import { DesktopChatStore } from '../../../../packages/agent-teams-worker/src/desktopChatStore';
import { mergeDesktopTeamConfig } from '../../../../packages/agent-teams-worker/src/desktopTransport';
import { DESKTOP_TEAM_TOOLS } from '../../../../packages/agent-teams-worker/src/membershipMcpProfile';

import type { RelayMembershipRoute } from '../../../../packages/agent-teams-relay/src/relayMembershipRouteStore';
import type { WorkerCodexAppServerSession } from '../../../../packages/agent-teams-worker/src/codexAppServerClient';
import type { WorkerTeamMembershipStore } from '../../../../packages/agent-teams-worker/src/workerTeamMembershipStore';

const fixture = async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'desktop-team-chat-test-'));
  const nodeId = randomUUID(),
    teamId = randomUUID(),
    membershipId = randomUUID(),
    peer = randomUUID();
  const members = [
    { nodeId, membershipId, role: 'member', status: 'active' },
    { nodeId: randomUUID(), membershipId: peer, role: 'lead', status: 'active' },
  ];
  const memberships = {
    get: (id: string) => (id === teamId ? { teamId, members } : undefined),
    list: () => [{ teamId, members }],
  } as unknown as WorkerTeamMembershipStore;
  const ownerConfig = {
    config: {
      mcp_servers: { agent_teams_control_other_installation: { command: '/other-owner' } },
      plugins: { personal: { enabled: true } },
      apps: { personal: { enabled: true } },
    },
  };
  const inventory = {
    data: [
      {
        name: 'agent-teams-runtime',
        tools: Object.fromEntries(DESKTOP_TEAM_TOOLS.map((t) => [t, {}])),
      },
    ],
  };
  const request = vi.fn(async (method: string, params: { threadId?: string }) => {
    if (method === 'config/read') return ownerConfig;
    if (method === 'mcpServerStatus/list') return inventory;
    return method === 'thread/start'
      ? { thread: { id: randomUUID() } }
      : { thread: { id: params.threadId, status: { type: 'idle' } } };
  });
  const session = {
    request,
    close: vi.fn(async () => {}),
    onClose: vi.fn(),
  } as unknown as WorkerCodexAppServerSession;
  const send = vi.fn();
  const openDesktop = vi.fn(async () => {});
  const options = {
    dataDir,
    nodeId,
    memberships,
    factory: { open: async () => session },
    mcp: { command: '/node', args: ['/bridge'] },
    connected: () => true,
    send,
    openDesktop,
  };
  return {
    dataDir,
    nodeId,
    teamId,
    membershipId,
    peer,
    members,
    request,
    options,
    inventory,
    ownerConfig,
  };
};

describe('desktop team bindings', () => {
  it('restricts inherited integrations on open, attach, and default-thread preparation', async () => {
    const f = await fixture();
    const service = new DesktopChatService(f.options);
    try {
      await service.action({ action: 'open', requestId: randomUUID(), teamId: f.teamId });
      await service.action({
        action: 'attach',
        requestId: randomUUID(),
        teamId: f.teamId,
        threadId: randomUUID(),
      });
      await service.action({ action: 'default', requestId: randomUUID(), teamId: f.teamId });
      const prepared = await service.prepare({ method: 'thread/start', requestId: randomUUID() });
      const configurations = [
        ...f.request.mock.calls
          .filter(([method]) => ['thread/start', 'thread/resume'].includes(method))
          .map(([, params]) => (params as Record<string, unknown>).config),
        prepared.config,
      ];
      expect(configurations).toHaveLength(3);
      for (const config of configurations)
        expect(config).toMatchObject({
          features: { apps: false, plugins: false },
          plugins: { personal: { enabled: false } },
          apps: { personal: { enabled: false }, _default: { enabled: false } },
          mcp_servers: {
            agent_teams_control_other_installation: { enabled: false },
            'agent-teams-runtime': { enabled_tools: [...DESKTOP_TEAM_TOOLS] },
          },
        });
      const resumed = configurations[1] as Record<string, unknown>;
      const merged = mergeDesktopTeamConfig(
        {
          config: {
            'mcp_servers.agent_teams_control_new.enabled': true,
            mcp_servers: { agent_teams_control_new: { enabled: true } },
            plugins: { new_plugin: { enabled: true } },
            apps: { new_app: { enabled: true } },
          },
        },
        resumed
      );
      expect(Object.hasOwn(merged.config, 'mcp_servers.agent_teams_control_new.enabled')).toBe(
        false
      );
      expect(merged.config).toMatchObject({
        mcp_servers: { agent_teams_control_new: { enabled: false } },
        plugins: { new_plugin: { enabled: false } },
        apps: { new_app: { enabled: false } },
      });
    } finally {
      await service.close();
    }
  });

  it('rejects an inherited owner inventory before opening or waking a membership turn', async () => {
    const f = await fixture();
    const service = new DesktopChatService({ ...f.options, messageDeliveryMode: 'mcp-inbox' });
    try {
      const threadId = (
        (await service.action({ action: 'open', requestId: randomUUID(), teamId: f.teamId })) as {
          threadId: string;
        }
      ).threadId;
      f.inventory.data.push({
        name: 'agent_teams_control_other_installation',
        tools: { review_approve: {} },
      });
      await expect(
        service.action({ action: 'attach', requestId: randomUUID(), teamId: f.teamId, threadId })
      ).rejects.toThrow('leaked server');
      await expect(
        service.prepare({ method: 'turn/start', threadId, requestId: randomUUID() })
      ).rejects.toThrow('leaked server');
      service.receive({
        id: randomUUID(),
        teamId: f.teamId,
        senderMembershipId: f.peer,
        recipientMembershipId: f.membershipId,
        text: 'Wake only with safe tools',
        sentAt: new Date().toISOString(),
      });
      await vi.waitFor(() =>
        expect(
          f.request.mock.calls.filter(([method]) => method === 'thread/resume').length
        ).toBeGreaterThan(1)
      );
      expect(f.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(0);
      expect(service.store.messages(f.teamId, true)).toHaveLength(1);
    } finally {
      await service.close();
    }
  });

  it.each(['inline', 'mcp-inbox'] as const)(
    'supports membership help/review messages and lead lookup without task authority in %s mode',
    async (mode) => {
      const f = await fixture();
      const service = new DesktopChatService({ ...f.options, messageDeliveryMode: mode });
      try {
        const opened = (await service.action({
          action: 'open',
          requestId: randomUUID(),
          teamId: f.teamId,
        })) as { threadId: string };
        const binding = service.store.byThread(opened.threadId)!;
        const taskRefs = [{ taskId: 'stable-task', displayId: '#17', teamName: 'Example team' }];
        for (const tool of ['support_request', 'review_request'] as const) {
          service.tool(binding.token, tool, { summary: 'Please check this task', taskRefs });
          const message = f.options.send.mock.calls.at(-1)![0];
          expect(message.senderMembershipId).toBe(f.membershipId);
          expect(message.recipientMembershipId).toBe(f.peer);
          expect(JSON.parse(message.text)).toMatchObject({
            kind: tool,
            taskRefs,
            summary: 'Please check this task',
          });
        }
        expect(() =>
          service.tool(binding.token, 'review_request', {
            summary: 'Spoof',
            senderMembershipId: f.peer,
          })
        ).toThrow();
        expect(() => service.tool(binding.token, 'review_approve', {})).toThrow('active task');
        service.tool(binding.token, 'message_send', {
          recipient: 'lead',
          message: 'A direct question',
        });
        expect(f.options.send.mock.calls.at(-1)![0].text).toBe('A direct question');
        f.members[1]!.role = 'member';
        expect(() =>
          service.tool(binding.token, 'support_request', { summary: 'No lead' })
        ).toThrow('no single active lead');
        expect(() =>
          service.tool(binding.token, 'review_request', {
            summary: 'Explicit peer in leaderless team',
            recipientMembershipId: f.peer,
          })
        ).not.toThrow();
      } finally {
        await service.close();
      }
    }
  );

  it('opens an idempotent persistent chat and preserves its token across restart', async () => {
    const f = await fixture();
    let service = new DesktopChatService(f.options);
    const action = { action: 'open', requestId: randomUUID(), teamId: f.teamId };
    try {
      const result = (await service.action(action)) as { threadId: string };
      const binding = service.store.byThread(result.threadId)!;
      expect(JSON.stringify(result)).not.toContain(binding.token);
      expect(service.tool(binding.token, 'runtime_context', {})).toMatchObject({
        context: { scope: 'membership', teamId: f.teamId },
      });
      await service.action(action);
      expect(f.request.mock.calls.filter((c) => c[0] === 'thread/start')).toHaveLength(1);
      await service.close();
      service = new DesktopChatService(f.options);
      expect(service.tool(binding.token, 'runtime_context', {})).toMatchObject({
        context: { threadId: result.threadId },
      });
      service.tool(binding.token, 'message_send', {
        recipientMembershipId: f.peer,
        message: 'echo',
      });
      expect(f.options.send).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: f.teamId,
          senderMembershipId: f.membershipId,
          text: 'echo',
        })
      );
      expect(() => service.tool(binding.token, 'result_submit', {})).toThrow('active task');
      f.members[0]!.status = 'left';
      expect(() =>
        service.tool(binding.token, 'message_send', {
          recipientMembershipId: f.peer,
          message: 'forbidden',
        })
      ).toThrow('active member');
    } finally {
      await service.close();
    }
  });
  it('wakes a membership conversation through IDs only and scopes read/processed receipts across restart', async () => {
    const f = await fixture();
    let service = new DesktopChatService({ ...f.options, messageDeliveryMode: 'mcp-inbox' });
    const message = {
      id: randomUUID(),
      teamId: f.teamId,
      senderMembershipId: f.peer,
      recipientMembershipId: f.membershipId,
      text: 'private peer message body',
      sentAt: new Date().toISOString(),
    };
    try {
      service.receive(message);
      await vi.waitFor(() =>
        expect(f.request.mock.calls.some(([method]) => method === 'turn/start')).toBe(true)
      );
      expect(f.options.openDesktop).not.toHaveBeenCalled();
      const binding = service.store.list()[0]!;
      const wake = f.request.mock.calls.find(([method]) => method === 'turn/start');
      expect(JSON.stringify(wake)).toContain(message.id);
      expect(JSON.stringify(wake)).not.toContain(message.text);
      expect(service.tool(binding.token, 'message_list', {})).toMatchObject({
        messages: [{ messageId: message.id, text: message.text }],
      });
      expect(service.tool(binding.token, 'message_get', { messageId: message.id })).toMatchObject({
        message: { readAt: expect.any(String) },
      });
      const foreign = { ...message, id: randomUUID(), recipientMembershipId: randomUUID() };
      service.receive(foreign);
      expect(() => service.tool(binding.token, 'message_get', { messageId: foreign.id })).toThrow(
        'not found'
      );
      expect(() => service.receive({ ...message, text: 'tampered replay' })).toThrow(
        'different content'
      );
      service.receive(message);
      await service.close();
      const startsBeforeRestart = f.request.mock.calls.filter(
        ([method]) => method === 'turn/start'
      ).length;
      service = new DesktopChatService({ ...f.options, messageDeliveryMode: 'mcp-inbox' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(f.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(
        startsBeforeRestart
      );
      const receipt = service.tool(binding.token, 'message_ack', { messageId: message.id });
      expect(receipt).toMatchObject({ message: { processedAt: expect.any(String) } });
      expect(service.tool(binding.token, 'message_ack', { messageId: message.id })).toEqual(
        receipt
      );
      expect(service.tool(binding.token, 'message_list', { unprocessedOnly: true })).toEqual({
        messages: [],
      });
      expect(f.options.send).not.toHaveBeenCalled();
      await service.close();
      const startsAfterAck = f.request.mock.calls.filter(
        ([method]) => method === 'turn/start'
      ).length;
      service = new DesktopChatService({ ...f.options, messageDeliveryMode: 'mcp-inbox' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(f.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(
        startsAfterAck
      );
    } finally {
      await service.close();
    }
  });

  it('queues inbox notifications while the membership conversation is active', async () => {
    const f = await fixture();
    const service = new DesktopChatService({ ...f.options, messageDeliveryMode: 'mcp-inbox' });
    try {
      await service.action({ action: 'open', requestId: randomUUID(), teamId: f.teamId });
      f.request.mockImplementation(async (method, params) => ({
        thread: { id: params.threadId, status: { type: 'active' } },
      }));
      service.receive({
        id: randomUUID(),
        teamId: f.teamId,
        senderMembershipId: f.peer,
        recipientMembershipId: f.membershipId,
        text: 'queued body',
        sentAt: new Date().toISOString(),
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(f.request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(0);
      expect(service.store.messages(f.teamId, true)).toHaveLength(1);
    } finally {
      await service.close();
    }
  });

  it('binds defaults only to new chats, isolates credentials, and rejects cross-team recipients', async () => {
    const f = await fixture();
    const service = new DesktopChatService(f.options);
    try {
      await expect(
        service.action({ action: 'default', teamId: randomUUID(), requestId: randomUUID() })
      ).rejects.toThrow('active member');
      await service.action({ action: 'default', teamId: f.teamId, requestId: randomUUID() });
      const a = await service.prepare({ method: 'thread/start', requestId: randomUUID() });
      const b = await service.prepare({ method: 'thread/start', requestId: randomUUID() });
      expect(a.bindingId).not.toEqual(b.bindingId);
      const token = service.store.get(a.bindingId!)!.token;
      expect(() => service.tool(token, 'runtime_context', {})).toThrow('not bound');
      const threadId = randomUUID();
      await service.bind({ bindingId: a.bindingId, threadId });
      await expect(
        service.bind({ bindingId: a.bindingId, threadId: randomUUID() })
      ).rejects.toThrow('conflict');
      expect(
        await service.prepare({
          method: 'thread/resume',
          requestId: randomUUID(),
          threadId: randomUUID(),
        })
      ).toEqual({});
      expect(() =>
        service.tool(token, 'message_send', {
          recipientMembershipId: randomUUID(),
          message: 'wrong team',
        })
      ).toThrow('another active');
      const merged = mergeDesktopTeamConfig(
        {
          config: {
            model: 'selected',
            mcp_servers: { personal: { enabled: true }, 'agent-teams-runtime': { enabled: false } },
          },
        },
        a.config!
      );
      expect((merged.config as Record<string, unknown>).model).toBe('selected');
      expect(merged.config.mcp_servers.personal).toEqual({ enabled: false });
      expect(merged.config.mcp_servers['agent-teams-runtime']).toMatchObject({ enabled: true });
      await service.action({ action: 'default', teamId: null, requestId: randomUUID() });
      expect(await service.prepare({ method: 'thread/start', requestId: randomUUID() })).toEqual(
        {}
      );
      expect(
        (await service.prepare({ method: 'thread/resume', requestId: randomUUID(), threadId }))
          .bindingId
      ).toBe(a.bindingId);
    } finally {
      await service.close();
    }
  });
});

describe('paired portal authorization and membership messaging', () => {
  it('routes only to the paired device and persists messages until the recipient acknowledges', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'desktop-chat-relay-test-'));
    const store = new DesktopChatStore(dir);
    const code = (await readFile(join(dir, 'desktop-pairing-code'), 'utf8')).trim();
    const node = randomUUID(),
      other = randomUUID(),
      team = randomUUID(),
      member = randomUUID(),
      peer = randomUUID();
    const routes = [
      { membershipId: member, nodeId: node, teamId: team, status: 'active' },
      { membershipId: peer, nodeId: other, teamId: team, status: 'active' },
    ] as unknown as RelayMembershipRoute[];
    const sent: unknown[] = [];
    const workers = () => [
      {
        nodeId: node,
        label: 'test-device',
        pairingHash: store.pairingHash,
        send: (v: unknown) => {
          const value = v as { type: string; request?: { requestId: string } };
          if (value.type === 'relay.desktop_control')
            broker.handle(node, {
              type: 'worker.desktop_result',
              requestId: value.request!.requestId,
              result: { ok: true },
            });
          else sent.push(v);
        },
      },
      {
        nodeId: other,
        label: 'test-lead',
        pairingHash: 'a'.repeat(64),
        send: (v: unknown) => sent.push(v),
      },
    ];
    const broker = new RelayDesktopChats({
      dataDir: dir,
      workers,
      memberships: () => routes,
      teamName: () => 'Test team',
    });
    const app = Fastify();
    broker.register(app);
    const call = (pairingCode: string, teamId?: string) =>
      app.inject({
        method: 'POST',
        url: '/join/api/desktop',
        payload: {
          pairingCode,
          request: { action: 'context', requestId: randomUUID(), ...(teamId ? { teamId } : {}) },
        },
      });
    try {
      expect((await call('x'.repeat(43))).statusCode).toBe(401);
      expect((await call(code, randomUUID())).statusCode).toBe(403);
      expect((await call(code)).json()).toMatchObject({
        device: { nodeId: node },
        teams: [{ teamId: team }],
        result: { ok: true },
      });
      const message = {
        id: randomUUID(),
        teamId: team,
        senderMembershipId: member,
        recipientMembershipId: peer,
        text: 'echo',
        sentAt: new Date().toISOString(),
      };
      broker.handle(other, { type: 'worker.desktop_message', message });
      expect(sent).not.toContainEqual({ type: 'relay.desktop_message', message });
      broker.handle(node, { type: 'worker.desktop_message', message });
      expect(sent).toContainEqual({ type: 'relay.desktop_message', message });
      broker.handle(node, { type: 'worker.desktop_message_ack', id: message.id });
      sent.length = 0;
      broker.flush(other);
      expect(sent).toHaveLength(1);
      broker.handle(other, { type: 'worker.desktop_message_ack', id: message.id });
      sent.length = 0;
      broker.flush(other);
      expect(sent).toHaveLength(0);
    } finally {
      broker.close();
      store.close();
      await app.close();
    }
  });
});
