// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { DesktopChatService } from '../../../../packages/agent-teams-worker/src/desktopChatService';
import { DESKTOP_TEAM_TOOLS } from '../../../../packages/agent-teams-worker/src/membershipMcpProfile';

import type { WorkerCodexAppServerSession } from '../../../../packages/agent-teams-worker/src/codexAppServerClient';
import type { WorkerTeamMembershipStore } from '../../../../packages/agent-teams-worker/src/workerTeamMembershipStore';

describe('membership submission recovery', () => {
  it('also holds an inline assignment fallback after a lost response and restart', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'assignment-response-lost-'));
    const nodeId = randomUUID(),
      teamId = randomUUID(),
      membershipId = randomUUID();
    const request = vi.fn(async () => ({ thread: { id: 'assignment-thread', turns: [] } }));
    const deliverAssignment = vi.fn(
      async (_message: unknown, beforeSubmit: (threadId: string, text: string) => boolean) => {
        beforeSubmit('assignment-thread', 'accepted assignment input');
        throw new Error('Accepted but response lost');
      }
    );
    const options = {
      dataDir,
      nodeId,
      connected: () => true,
      send: () => {},
      deliverAssignment,
      mcp: { command: '/fixture', args: [] },
      memberships: {
        get: () => ({ members: [{ nodeId, membershipId, status: 'active' }] }),
        list: () => [],
      } as unknown as WorkerTeamMembershipStore,
      factory: {
        open: async () =>
          ({
            request,
            close: async () => {},
            onClose: () => {},
          }) as unknown as WorkerCodexAppServerSession,
      },
    };
    const message = {
      id: randomUUID(),
      teamId,
      senderMembershipId: randomUUID(),
      recipientMembershipId: membershipId,
      text: 'Reply once',
      sentAt: new Date().toISOString(),
    };
    let service = new DesktopChatService(options);
    try {
      service.receive(message);
      await vi.waitFor(() =>
        expect(service.store.submissions.get(message.id)?.state).toBe('uncertain')
      );
      await service.close();
      service = new DesktopChatService(options);
      service.receive(message);
      await vi.waitFor(() => expect(request).toHaveBeenCalled());
      expect(deliverAssignment).toHaveBeenCalledTimes(1);
      expect(service.store.messages(teamId, true)).toHaveLength(1);
    } finally {
      await service.close();
    }
  });
  it.each(['visible', 'after-restart', 'unprovable'] as const)(
    'does not replay a turn accepted before its response was lost (%s)',
    async (visibility) => {
      const dataDir = await mkdtemp(join(tmpdir(), 'membership-response-lost-'));
      const nodeId = randomUUID(),
        teamId = randomUUID(),
        membershipId = randomUUID();
      const threadId = randomUUID(),
        turnId = randomUUID();
      let visible = visibility === 'visible';
      let acceptedInput: unknown;
      const request = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
        if (method === 'config/read') return { config: {} };
        if (method === 'mcpServerStatus/list')
          return {
            data: [
              {
                name: 'agent-teams-runtime',
                tools: Object.fromEntries(DESKTOP_TEAM_TOOLS.map((name) => [name, {}])),
              },
            ],
          };
        if (method === 'turn/start') {
          acceptedInput = (params as { input: unknown }).input;
          throw new Error('Accepted; response connection lost');
        }
        return {
          thread: {
            id: threadId,
            status: { type: 'idle' },
            turns:
              visible && acceptedInput
                ? [{ id: turnId, items: [{ type: 'userMessage', content: acceptedInput }] }]
                : [],
          },
        };
      });
      const session = {
        request,
        close: async () => {},
        onClose: () => {},
      } as unknown as WorkerCodexAppServerSession;
      const options = {
        dataDir,
        nodeId,
        factory: { open: async () => session },
        memberships: {
          get: () => ({ members: [{ nodeId, membershipId, status: 'active' }] }),
          list: () => [],
        } as unknown as WorkerTeamMembershipStore,
        mcp: { command: '/fixture', args: [] },
        connected: () => true,
        send: () => {},
        messageDeliveryMode: 'mcp-inbox' as const,
      };
      let service = new DesktopChatService(options);
      const message = {
        id: randomUUID(),
        teamId,
        senderMembershipId: randomUUID(),
        recipientMembershipId: membershipId,
        text: 'Please reply once',
        sentAt: new Date().toISOString(),
      };
      try {
        service.receive(message);
        await vi.waitFor(() =>
          expect(service.store.submissions.get(message.id)).toMatchObject({
            state: visibility === 'visible' ? 'accepted' : 'uncertain',
          })
        );
        service.receive(message);
        await service.close();
        if (visibility === 'after-restart') visible = true;
        service = new DesktopChatService(options);
        if (visibility !== 'unprovable') {
          await vi.waitFor(() =>
            expect(service.store.submissions.get(message.id)?.state).toBe('accepted')
          );
          expect(service.store.messages(teamId, true)).toHaveLength(0);
        } else {
          service.receive(message);
          await vi.waitFor(() =>
            expect(request.mock.calls.filter(([m]) => m === 'thread/read').length).toBeGreaterThan(
              2
            )
          );
          expect(service.store.submissions.get(message.id)).toMatchObject({
            state: 'uncertain',
            error: 'Accepted; response connection lost',
          });
          expect(service.store.messages(teamId, true)).toHaveLength(1);
        }
        expect(request.mock.calls.filter(([m]) => m === 'turn/start')).toHaveLength(1);
      } finally {
        await service.close();
      }
    }
  );
});
