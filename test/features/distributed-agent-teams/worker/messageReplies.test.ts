// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  commandEnvelopeSchema,
  teamMessageDeliveryPayloadSchema,
} from '@claude-teams/agent-teams-protocol';
import { describe, expect, it, vi } from 'vitest';

import { DesktopChatService } from '../../../../packages/agent-teams-worker/src/desktopChatService';
import { DESKTOP_TEAM_TOOLS } from '../../../../packages/agent-teams-worker/src/membershipMcpProfile';
import { decodeTeamReply } from '../../../../packages/agent-teams-worker/src/teamMessageReplies';
import { fixture } from '../topology/fixtures/mcpInboxRuntime';

import type { WorkerCodexAppServerSession } from '../../../../packages/agent-teams-worker/src/codexAppServerClient';
import type { WorkerTeamMembershipStore } from '../../../../packages/agent-teams-worker/src/workerTeamMembershipStore';

describe('scoped reply associations', () => {
  it('keeps membership processing and replies independent, scoped, atomic, and durable', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'membership-reply-test-'));
    const nodeId = randomUUID(),
      teamId = randomUUID(),
      membershipId = randomUUID();
    const peer = randomUUID(),
      other = randomUUID(),
      threadId = randomUUID();
    const session = {
      request: async (method: string) =>
        method === 'config/read'
          ? { config: {} }
          : method === 'mcpServerStatus/list'
            ? {
                data: [
                  {
                    name: 'agent-teams-runtime',
                    tools: Object.fromEntries(DESKTOP_TEAM_TOOLS.map((name) => [name, {}])),
                  },
                ],
              }
            : { thread: { id: threadId, status: { type: 'idle' } } },
      close: async () => {},
      onClose: () => {},
    } as unknown as WorkerCodexAppServerSession;
    const members = [
      { nodeId, membershipId, role: 'member', status: 'active' },
      { nodeId: randomUUID(), membershipId: peer, role: 'lead', status: 'active' },
      { nodeId: randomUUID(), membershipId: other, role: 'member', status: 'active' },
    ];
    const send = vi.fn();
    const options = {
      dataDir,
      nodeId,
      factory: { open: async () => session },
      memberships: {
        get: () => ({ members }),
        list: () => [],
      } as unknown as WorkerTeamMembershipStore,
      mcp: { command: '/fixture', args: [] },
      connected: () => true,
      send,
      messageDeliveryMode: 'mcp-inbox' as const,
    };
    let service = new DesktopChatService(options);
    try {
      await service.action({ action: 'open', requestId: randomUUID(), teamId });
      const binding = service.store.byThread(threadId)!;
      const incoming = {
        id: randomUUID(),
        teamId,
        senderMembershipId: peer,
        recipientMembershipId: membershipId,
        text: 'Question',
        sentAt: new Date().toISOString(),
      };
      service.receive(incoming);
      const acknowledged = { ...incoming, id: randomUUID() };
      service.receive(acknowledged);
      expect(
        service.tool(binding.token, 'message_ack', { messageId: acknowledged.id })
      ).toMatchObject({
        message: { processedAt: expect.any(String) },
      });
      expect(service.store.listForMembership(teamId, membershipId)[1]?.repliedAt).toBeUndefined();
      const reply = { recipient: 'lead', message: 'Answer', inReplyToMessageId: incoming.id };
      const foreign = { ...incoming, id: randomUUID(), teamId: randomUUID() };
      service.store.putMessage(foreign, 'in');
      expect(() =>
        service.tool(binding.token, 'message_send', { ...reply, inReplyToMessageId: foreign.id })
      ).toThrow('inbox');
      expect(() =>
        service.tool(binding.token, 'message_send', { ...reply, senderMembershipId: peer })
      ).toThrow();
      expect(service.store.listForMembership(teamId, membershipId)[0]).toMatchObject({
        acceptedAt: expect.any(String),
      });
      expect(() =>
        service.tool(binding.token, 'message_send', { ...reply, inReplyToMessageId: randomUUID() })
      ).toThrow('inbox');
      expect(() =>
        service.tool(binding.token, 'message_send', {
          ...reply,
          recipient: undefined,
          recipientMembershipId: other,
        })
      ).toThrow('different sender');
      expect(send).not.toHaveBeenCalled();
      service.store.db
        .exec(`CREATE TRIGGER reject_reply BEFORE INSERT ON messages WHEN NEW.direction='out'
        BEGIN SELECT RAISE(ABORT, 'simulated outbox failure'); END`);
      expect(() => service.tool(binding.token, 'message_send', reply)).toThrow('outbox failure');
      expect(service.store.listForMembership(teamId, membershipId)[0]?.repliedAt).toBeUndefined();
      service.store.db.exec('DROP TRIGGER reject_reply');
      const result = service.tool(binding.token, 'message_send', reply);
      expect(service.tool(binding.token, 'message_send', reply)).toEqual(result);
      expect(service.store.messages(teamId, false, 'out')).toHaveLength(1);
      const sent = send.mock.calls[0]![0];
      expect(decodeTeamReply(sent.text)).toEqual({
        text: 'Answer',
        inReplyToMessageId: incoming.id,
      });
      expect(service.store.listForMembership(teamId, membershipId)[0]).toMatchObject({
        repliedAt: expect.any(String),
        replyMessageId: sent.id,
      });
      expect(service.store.listForMembership(teamId, membershipId)[0]?.processedAt).toBeUndefined();
      await service.close();
      service = new DesktopChatService(options);
      expect(service.tool(binding.token, 'message_get', { messageId: incoming.id })).toMatchObject({
        message: { repliedAt: expect.any(String), replyMessageId: sent.id },
      });
      service.receive({ ...incoming, id: randomUUID(), text: sent.text });
      expect(service.tool(binding.token, 'message_list', {})).toMatchObject({
        messages: expect.arrayContaining([
          expect.objectContaining({ text: 'Answer', inReplyToMessageId: incoming.id }),
        ]),
      });
    } finally {
      await service.close();
    }
  });

  it('validates task reply scope, records only after durable enqueue, and restores projection on restart', async () => {
    const f = await fixture();
    const db = new DatabaseSync(join(f.options.dataDir, 'worker.sqlite'));
    try {
      const incoming = f.send('Question');
      await vi.waitFor(() => expect(f.worker().listMessages()[0]?.steerState).toBe('delivered'));
      const peer = await f.roster();
      const reply = {
        recipientMembershipId: peer.membershipId,
        message: 'Answer',
        inReplyToMessageId: incoming.messageId,
      };
      await expect(
        f.call('message_send', { ...reply, inReplyToMessageId: randomUUID() })
      ).rejects.toThrow('inbox');
      await expect(
        f.call('message_send', { ...reply, recipient: 'lead', recipientMembershipId: undefined })
      ).rejects.toThrow('different sender');
      await expect(
        f.call('message_send', { ...reply, recipientMembershipId: f.membershipId })
      ).rejects.toThrow('another active');
      // The fixture roster peer differs from this synthetic inbound sender; use a fresh scoped
      // delivery whose authenticated sender is the selected peer.
      const scoped = f.send('Scoped question');
      const targetId = randomUUID();
      const envelope = commandEnvelopeSchema.parse({
        ...scoped.command,
        commandId: randomUUID(),
        sequence: scoped.command.sequence + 100,
        payload: {
          ...teamMessageDeliveryPayloadSchema.parse(scoped.command.payload),
          messageId: targetId,
          senderMembershipId: peer.membershipId,
        },
      });
      f.relay.enqueueCommand(envelope);
      await vi.waitFor(() => expect(f.worker().listMessages()).toHaveLength(3));
      const valid = { recipient: 'lead', message: 'Scoped answer', inReplyToMessageId: targetId };
      const foreignId = randomUUID();
      f.relay.enqueueCommand(
        commandEnvelopeSchema.parse({
          ...envelope,
          commandId: randomUUID(),
          sequence: envelope.sequence + 1,
          leaseEpoch: (envelope.leaseEpoch ?? 0) + 1,
          payload: {
            ...teamMessageDeliveryPayloadSchema.parse(envelope.payload),
            messageId: foreignId,
          },
        })
      );
      await vi.waitFor(() => expect(f.worker().listMessages()).toHaveLength(4));
      await expect(
        f.call('message_send', { ...valid, inReplyToMessageId: foreignId })
      ).rejects.toThrow('inbox');
      await expect(
        f.call('message_send', { ...valid, senderMembershipId: peer.membershipId })
      ).rejects.toThrow();
      db.exec(`CREATE TRIGGER reject_reply BEFORE INSERT ON outbox_events
        WHEN NEW.idempotency_key LIKE 'runtime:%' BEGIN SELECT RAISE(ABORT, 'simulated outbox failure'); END`);
      await expect(f.call('message_send', valid)).rejects.toThrow('outbox failure');
      expect(
        f
          .worker()
          .listMessages()
          .find((m) => m.messageId === targetId)?.repliedAt
      ).toBeUndefined();
      db.exec('DROP TRIGGER reject_reply');
      const sent = await f.call('message_send', valid, 'reply-idempotency-test');
      const eventsAfterReply = f.worker().listOutboxEvents().length;
      expect(
        (await f.call('message_send', valid, 'reply-idempotency-test')).event.envelope
      ).toEqual(sent.event.envelope);
      expect(f.worker().listOutboxEvents()).toHaveLength(eventsAfterReply);
      expect(decodeTeamReply(sent.event.envelope.payload.message)).toEqual({
        text: 'Scoped answer',
        inReplyToMessageId: targetId,
      });
      expect((await f.call('message_get', { messageId: targetId })).message).toMatchObject({
        repliedAt: expect.any(String),
      });
      expect(
        (await f.call('message_get', { messageId: targetId })).message.processedAt
      ).toBeUndefined();
      await f.call('message_ack', { messageId: incoming.messageId });
      expect(
        f
          .worker()
          .listMessages()
          .find((m) => m.messageId === incoming.messageId)?.repliedAt
      ).toBeUndefined();
      // Simulate a crash after the durable event, before receipt projection.
      db.prepare('DELETE FROM message_replies WHERE messageId=?').run(targetId);
      await f.restart();
      expect(
        f
          .worker()
          .listMessages()
          .find((m) => m.messageId === targetId)
      ).toMatchObject({ repliedAt: expect.any(String) });
    } finally {
      db.close();
      await f.close();
    }
  });
});
