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
  const request = vi.fn(async (method: string, params: { threadId?: string }) =>
    method === 'thread/start'
      ? { thread: { id: randomUUID() } }
      : { thread: { id: params.threadId, status: { type: 'idle' } } }
  );
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
  return { dataDir, nodeId, teamId, membershipId, peer, members, request, options };
};

describe('desktop team bindings', () => {
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
  it('binds defaults only to new chats, isolates credentials, and rejects cross-team recipients', async () => {
    const f = await fixture();
    const service = new DesktopChatService(f.options);
    try {
      await expect(
        service.action({ action: 'default', teamId: randomUUID(), requestId: randomUUID() })
      ).rejects.toThrow('active member');
      await service.action({ action: 'default', teamId: f.teamId, requestId: randomUUID() });
      const a = service.prepare({ method: 'thread/start', requestId: randomUUID() });
      const b = service.prepare({ method: 'thread/start', requestId: randomUUID() });
      expect(a.bindingId).not.toEqual(b.bindingId);
      const token = service.store.get(a.bindingId!)!.token;
      expect(() => service.tool(token, 'runtime_context', {})).toThrow('not bound');
      const threadId = randomUUID();
      await service.bind({ bindingId: a.bindingId, threadId });
      await expect(
        service.bind({ bindingId: a.bindingId, threadId: randomUUID() })
      ).rejects.toThrow('conflict');
      expect(
        service.prepare({
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
      expect(merged.config.mcp_servers.personal).toEqual({ enabled: true });
      expect(merged.config.mcp_servers['agent-teams-runtime']).toMatchObject({ enabled: true });
      await service.action({ action: 'default', teamId: null, requestId: randomUUID() });
      expect(service.prepare({ method: 'thread/start', requestId: randomUUID() })).toEqual({});
      expect(
        service.prepare({ method: 'thread/resume', requestId: randomUUID(), threadId }).bindingId
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
