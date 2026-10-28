// @vitest-environment node
import { fixture } from './fixtures/mcpInboxRuntime';

describe('MCP inbox runtime delivery', () => {
  it.each(['inline', 'mcp-inbox'] as const)(
    'implements support and review requests as durable authenticated messages in %s mode',
    async (mode) => {
      const f = await fixture(mode);
      try {
        const peer = await f.roster();
        const taskRefs = [{ taskId: 'task-uuid', displayId: '#17', teamName: 'Example team' }];
        for (const tool of ['support_request', 'review_request'] as const) {
          const result = await f.call(tool, {
            recipient: 'lead',
            summary: 'Check the parser boundary',
            details: 'Keep this linked to the original task.',
            taskRefs,
            artifacts: ['changes/parser.patch'],
          });
          expect(result.event.envelope.type).toBe('team.message');
          expect(result.event.envelope.payload.senderMembershipId).toBe(f.membershipId);
          expect(result.event.envelope.payload.recipientMembershipId).toBe(peer.membershipId);
          expect(JSON.parse(result.event.envelope.payload.message)).toEqual({
            type: 'agent-teams.collaboration-request',
            version: 1,
            kind: tool,
            summary: 'Check the parser boundary',
            details: 'Keep this linked to the original task.',
            taskRefs,
            artifacts: ['changes/parser.patch'],
          });
        }
        expect(f.worker().listAssignments()[0]?.state).toBe('running');
        await expect(
          f.call('review_request', { summary: 'Approve', recipient: 'lead', approved: true })
        ).rejects.toThrow();
        await expect(
          f.call('support_request', {
            summary: 'Spoof',
            recipient: 'lead',
            senderMembershipId: peer.membershipId,
          })
        ).rejects.toThrow();
        await expect(
          f.call('support_request', {
            summary: 'Wrong member',
            recipientMembershipId: f.membershipId,
          })
        ).rejects.toThrow('another active');
        const direct = await f.call('message_send', {
          recipient: 'lead',
          message: 'Direct question to the current lead',
        });
        expect(direct.event.envelope.payload.recipientMembershipId).toBe(peer.membershipId);
      } finally {
        await f.close();
      }
    }
  );

  it('steers IDs only, scopes MCP reads, and records processed acknowledgement without a Relay message', async () => {
    const f = await fixture();
    try {
      const sent = f.send('confidential peer body must travel only through MCP');
      await vi.waitFor(() => expect(f.worker().listMessages()[0]?.steerState).toBe('delivered'));
      const wake = f.codex.requests.find(({ method }) => method === 'turn/steer');
      expect(JSON.stringify(wake)).toContain(sent.messageId);
      expect(JSON.stringify(wake)).not.toContain('confidential peer body');
      expect(f.worker().listMessages()[0]?.readAt).toBeUndefined();
      const listed = await f.call('message_list', { unprocessedOnly: true });
      expect(listed.messages).toHaveLength(1);
      expect(listed.messages[0].text).toContain('confidential peer body');
      const read = await f.call('message_get', { messageId: sent.messageId });
      expect(read.message.readAt).toEqual(expect.any(String));
      expect(read.message.processedAt).toBeUndefined();
      const foreign = f.send('wrong lease body', f.worker().listAssignments()[0]!.leaseEpoch! + 1);
      await vi.waitFor(() => expect(f.worker().listMessages()).toHaveLength(2));
      await expect(f.call('message_get', { messageId: foreign.messageId })).rejects.toThrow(
        'not found'
      );
      expect((await f.call('message_list')).messages).toHaveLength(1);
      const eventsBefore = f.worker().listOutboxEvents().length;
      const receipt = await f.call('message_ack', { messageId: sent.messageId });
      expect(receipt.message.processedAt).toEqual(expect.any(String));
      expect((await f.call('message_ack', { messageId: sent.messageId })).message.processedAt).toBe(
        receipt.message.processedAt
      );
      expect(f.worker().listOutboxEvents()).toHaveLength(eventsBefore);
      expect((await f.call('message_list', { unprocessedOnly: true })).messages).toHaveLength(0);
    } finally {
      await f.close();
    }
  });

  it('queues while approval is pending, then wakes the completed thread without message bodies', async () => {
    const f = await fixture();
    try {
      for (const listener of f.codex.serverRequests)
        listener({
          id: 'approval-1',
          method: 'item/commandExecution/requestApproval',
          params: { threadId: f.codex.threadId, turnId: f.codex.turnId },
        });
      const sent = f.send('queued private body');
      await vi.waitFor(() => expect(f.worker().listMessages()).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(f.codex.requests.filter(({ method }) => method === 'turn/steer')).toHaveLength(0);
      f.codex.emit('turn/completed', {
        turn: { id: f.codex.turnId, status: 'completed', items: [], error: null },
      });
      await vi.waitFor(() => expect(f.worker().listMessages()[0]?.steerState).toBe('delivered'));
      expect(f.codex.requests.filter(({ method }) => method === 'turn/start')).toHaveLength(2);
      const wake = f.codex.requests.filter(({ method }) => method === 'turn/start')[1];
      expect(JSON.stringify(wake)).toContain(sent.messageId);
      expect(JSON.stringify(wake)).not.toContain('queued private body');
      expect(f.worker().listMessages()[0]?.processedAt).toBeUndefined();
    } finally {
      await f.close();
    }
  });

  it('batches queued inbox IDs after an approval resolves without a second task turn', async () => {
    const f = await fixture();
    try {
      for (const listener of f.codex.serverRequests)
        listener({
          id: 'approval-batch',
          method: 'item/commandExecution/requestApproval',
          params: { threadId: f.codex.threadId, turnId: f.codex.turnId },
        });
      const first = f.send('first batched body');
      const second = f.send('second batched body');
      await vi.waitFor(() => expect(f.worker().listMessages()).toHaveLength(2));
      expect(f.codex.requests.filter(({ method }) => method === 'turn/steer')).toHaveLength(0);
      f.codex.emit('serverRequest/resolved', { requestId: 'approval-batch' });
      await vi.waitFor(() =>
        expect(
          f
            .worker()
            .listMessages()
            .every((message) => message.steerState === 'delivered')
        ).toBe(true)
      );
      const steers = f.codex.requests.filter(({ method }) => method === 'turn/steer');
      expect(steers).toHaveLength(1);
      expect(JSON.stringify(steers[0])).toContain(first.messageId);
      expect(JSON.stringify(steers[0])).toContain(second.messageId);
      expect(JSON.stringify(steers[0])).not.toContain('batched body');
      expect(f.codex.requests.filter(({ method }) => method === 'turn/start')).toHaveLength(1);
    } finally {
      await f.close();
    }
  });

  it('retains unprocessed inbox state across a fenced restart and keeps inline delivery compatible', async () => {
    const f = await fixture();
    try {
      const sent = f.send('restart body');
      await vi.waitFor(() => expect(f.worker().listMessages()[0]?.steerState).toBe('delivered'));
      await f.call('message_get', { messageId: sent.messageId });
      await f.restart();
      expect(f.worker().listMessages()[0]).toMatchObject({
        messageId: sent.messageId,
        steerState: 'delivered',
        steerAttempts: 1,
        payload: { message: 'restart body' },
      });
      expect(f.worker().listMessages()[0]?.processedAt).toBeUndefined();
      await expect(f.call('message_get', { messageId: sent.messageId })).rejects.toThrow();
      expect(f.worker().listRuntimeBindings()[0]?.state).toBe('interrupted');
    } finally {
      await f.close();
    }
    const inline = await fixture('inline');
    try {
      inline.send('legacy inline body');
      await vi.waitFor(() =>
        expect(inline.worker().listMessages()[0]?.steerState).toBe('delivered')
      );
      expect(
        JSON.stringify(inline.codex.requests.find(({ method }) => method === 'turn/steer'))
      ).toContain('legacy inline body');
      expect(inline.worker().listMessages()[0]?.readAt).toEqual(expect.any(String));
    } finally {
      await inline.close();
    }
  });

  it.each(['turn/start', 'turn/steer'])(
    'holds an accepted %s whose response was lost, including after restart',
    async (lostMethod) => {
      const f = await fixture();
      const original = f.codex.request;
      f.codex.request = async <T>(method: string, params?: unknown): Promise<T> => {
        const accepted = await original<T>(method, params);
        if (method === lostMethod) throw new Error('Accepted but response lost');
        return accepted;
      };
      try {
        if (lostMethod === 'turn/start')
          f.codex.emit('turn/completed', {
            turn: { id: f.codex.turnId, status: 'completed', items: [], error: null },
          });
        const before = f.codex.requests.filter(({ method }) => method === lostMethod).length;
        const sent = f.send('Run this request only once');
        await vi.waitFor(() =>
          expect(f.worker().listMessages()[0]).toMatchObject({
            messageId: sent.messageId,
            steerState: 'uncertain',
            steerAttempts: 1,
          })
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(f.codex.requests.filter(({ method }) => method === lostMethod)).toHaveLength(
          before + 1
        );
        await f.restart();
        expect(f.worker().listMessages()[0]).toMatchObject({
          steerState: 'uncertain',
          steerAttempts: 1,
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(f.codex.requests.filter(({ method }) => method === lostMethod)).toHaveLength(
          before + 1
        );
      } finally {
        await f.close();
      }
    }
  );
});
