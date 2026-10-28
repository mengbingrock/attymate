import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  SESSION_EXPIRES_MS,
  desktopChatActionSchema,
  desktopMessageSchema,
  type DesktopTeamMessage,
} from '@claude-teams/agent-teams-protocol';
import type {
  WorkerCodexAppServerSession,
  WorkerCodexAppServerSessionFactory,
} from './codexAppServerClient';
import type { WorkerTeamMembershipStore } from './workerTeamMembershipStore';
import type { CodexRuntimeMcpLaunchSpec } from './codexRuntimeMcpProfile';
import { SessionPresence } from './sessionPresence';
import { DesktopChatStore, type DesktopChatBinding } from './desktopChatStore';
import { isTeamCommunicationTool, teamCommunicationMessage } from './teamCollaborationRequests';
import { messageIdParameters, messageListParameters } from './runtimeMcpServer';
import { teamInboxNotification, type TeamMessageDeliveryMode } from './teamMessageDelivery';
import { assertMembershipMcpInventory, membershipMcpConfig } from './membershipMcpProfile';
import { reconcileMessageSubmission } from './messageSubmissionStore';
import { decodeTeamReply } from './teamMessageReplies';

export { DESKTOP_TEAM_TOOLS } from './membershipMcpProfile';

const threadSchema = z.object({
  thread: z.object({ id: z.string(), status: z.object({ type: z.string() }).optional() }),
});

/** A membership-scoped chat, deliberately independent of task execution leases. */
export class DesktopChatService {
  readonly store: DesktopChatStore;
  readonly presence = new SessionPresence();
  private session?: Promise<WorkerCodexAppServerSession>;
  private delivery?: Promise<void>;
  private deliveryRequested = false;
  private stopped = false;
  private timer: NodeJS.Timeout;
  private operations = new Map<string, Promise<unknown>>();
  constructor(
    private readonly options: {
      dataDir: string;
      nodeId: string;
      memberships: WorkerTeamMembershipStore;
      factory: WorkerCodexAppServerSessionFactory;
      mcp: CodexRuntimeMcpLaunchSpec;
      connected: () => boolean;
      send: (message: DesktopTeamMessage) => void;
      openDesktop?: (threadId: string) => Promise<void>;
      messageDeliveryMode?: TeamMessageDeliveryMode;
      deliverAssignment?: (
        message: DesktopTeamMessage,
        beforeSubmit: (threadId: string, text: string) => boolean
      ) => Promise<boolean>;
    }
  ) {
    this.store = new DesktopChatStore(options.dataDir);
    this.timer = setInterval(() => this.scheduleDelivery(), 3000);
    this.timer.unref();
    if (options.messageDeliveryMode === 'mcp-inbox') {
      this.store.requeueUnprocessedNotifications();
      this.scheduleDelivery();
    }
  }

  private async connection(): Promise<WorkerCodexAppServerSession> {
    this.session ??= this.options.factory
      .open()
      .then((session) => {
        session.onClose(() => {
          this.session = undefined;
          this.presence.clear();
        });
        return session;
      })
      .catch((error) => {
        this.session = undefined;
        throw error;
      });
    return this.session;
  }
  private membership(teamId: string, membershipId?: string) {
    if (!this.options.connected())
      throw new Error('Relay is offline; team authorization cannot be verified');
    const team = this.options.memberships.get(teamId);
    const member = team?.members.find(
      (m) =>
        m.nodeId === this.options.nodeId &&
        m.status === 'active' &&
        (!membershipId || m.membershipId === membershipId)
    );
    if (!member) throw new Error('This device is not an active member of that team');
    return { team, member };
  }
  context() {
    return {
      defaultTeamId: this.store.defaultTeam,
      teams: this.options.memberships.list(),
      chats: this.store
        .list()
        .filter((b) => b.threadId)
        .map(({ token: _token, ...binding }) => binding),
    };
  }
  private async config(binding: DesktopChatBinding) {
    this.membership(binding.teamId, binding.membershipId);
    return membershipMcpConfig(await this.connection(), this.options.mcp, binding.token);
  }
  action(input: unknown): Promise<unknown> {
    const request = desktopChatActionSchema.parse(input);
    const existing = this.operations.get(request.requestId);
    if (existing) return existing;
    const operation = this.execute(request).finally(() =>
      this.operations.delete(request.requestId)
    );
    this.operations.set(request.requestId, operation);
    return operation;
  }
  private async execute(request: z.infer<typeof desktopChatActionSchema>, openDesktop = true) {
    if (request.action === 'context') return this.context();
    if (request.action === 'default') {
      if (request.teamId) this.membership(request.teamId);
      this.store.defaultTeam = request.teamId ?? null;
      return this.context();
    }
    if (!request.teamId) throw new Error('Select a team');
    const { member } = this.membership(request.teamId);
    const session = await this.connection();
    let binding = this.store.create(request.requestId, request.teamId, member.membershipId);
    if (request.action === 'attach') {
      if (!request.threadId) throw new Error('Select a chat');
      const old = this.store.byThread(request.threadId);
      if (old && old.teamId !== request.teamId)
        throw new Error('This chat already belongs to another team; open a new chat');
      const read = threadSchema.parse(
        await session.request('thread/read', { threadId: request.threadId })
      );
      if (read.thread.status?.type === 'active')
        throw new Error('Wait for the current turn to finish');
      if (old) binding = old;
      else this.store.bind(binding.id, request.threadId);
      await session.request('thread/resume', {
        threadId: request.threadId,
        config: await this.config(binding),
      });
      await assertMembershipMcpInventory(session, request.threadId);
    } else if (!binding.threadId) {
      const cwd = join(this.options.dataDir, 'team-chat-workspaces', binding.id);
      await mkdir(cwd, { recursive: true, mode: 0o700 });
      const result = threadSchema.parse(
        await session.request('thread/start', {
          cwd,
          ephemeral: false,
          approvalPolicy: 'on-request',
          sandbox: 'read-only',
          config: await this.config(binding),
          developerInstructions:
            'This is a persistent Agent Teams chat. Use tool discovery or the code execution wrapper when needed to find agent-teams-runtime tools. Call runtime_context to discover your team and role. Use message_send to communicate with teammates; ordinary assistant text stays in this chat. Read message_list for incoming messages. Do not claim a task result without an active assignment.',
        })
      );
      this.store.bind(binding.id, result.thread.id);
      await assertMembershipMcpInventory(session, result.thread.id);
      await this.persistSelection(result.thread.id);
      await session.request('thread/name/set', {
        threadId: result.thread.id,
        name: `Team chat — ${member.label}`,
      });
    } else {
      await session.request('thread/resume', {
        threadId: binding.threadId,
        config: await this.config(binding),
      });
      await assertMembershipMcpInventory(session, binding.threadId);
    }
    binding = this.store.get(binding.id)!;
    let desktopOpened = false;
    if (openDesktop && binding.threadId && this.options.openDesktop) {
      await this.options.openDesktop(binding.threadId);
      desktopOpened = true;
    }
    return {
      threadId: binding.threadId,
      teamId: binding.teamId,
      desktopOpened,
      url: `codex://threads/${binding.threadId}?hostId=local`,
      ...this.context(),
    };
  }
  /** Called only by the local desktop transport; never exposed through the public portal. */
  async prepare(input: unknown) {
    const request = z
      .object({
        method: z.enum(['thread/start', 'thread/resume', 'turn/start']),
        threadId: z.string().optional(),
        requestId: z.uuid(),
      })
      .strict()
      .parse(input);
    let binding = request.threadId ? this.store.byThread(request.threadId) : undefined;
    if (!binding && request.method === 'thread/start' && this.store.defaultTeam) {
      const { member } = this.membership(this.store.defaultTeam);
      binding = this.store.create(request.requestId, this.store.defaultTeam, member.membershipId);
    }
    if (!binding) return {};
    if (request.method === 'turn/start') {
      this.membership(binding.teamId, binding.membershipId);
      await assertMembershipMcpInventory(await this.connection(), binding.threadId!);
      return { bindingId: binding.id };
    }
    return { bindingId: binding.id, config: await this.config(binding), presenceVersion: 1 };
  }
  async bind(input: unknown) {
    const p = z
      .object({
        bindingId: z.uuid(),
        threadId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/),
        connectionId: z.uuid().optional(),
      })
      .strict()
      .parse(input);
    const binding = this.store.get(p.bindingId);
    if (!binding || (binding.threadId && binding.threadId !== p.threadId))
      throw new Error('Chat binding conflict');
    this.membership(binding.teamId, binding.membershipId);
    const connection = await this.connection();
    await assertMembershipMcpInventory(connection, p.threadId);
    if ((await this.session) !== connection) throw new Error('App Server connection changed');
    this.store.bind(p.bindingId, p.threadId);
    if (!binding.threadId) await this.persistSelection(p.threadId);
    if ((await this.session) !== connection) throw new Error('App Server connection changed');
    this.membership(binding.teamId, binding.membershipId);
    if (p.connectionId)
      this.presence.attach(p.connectionId, p.bindingId, {
        teamId: binding.teamId,
        membershipId: binding.membershipId,
        threadId: p.threadId,
      });
    return { ok: true };
  }
  updatePresence(input: unknown) {
    const request = z
      .discriminatedUnion('action', [
        z
          .object({
            action: z.literal('heartbeat'),
            connectionId: z.uuid(),
            ageMs: z.number().finite().nonnegative().max(SESSION_EXPIRES_MS),
          })
          .strict(),
        z
          .object({
            action: z.literal('detach'),
            connectionId: z.uuid(),
            threadId: z.string().max(100).optional(),
          })
          .strict(),
      ])
      .parse(input);
    if (request.action === 'detach') this.presence.detach(request.connectionId, request.threadId);
    else this.presence.renew(request.connectionId, request.ageMs);
    return { ok: true };
  }
  presenceSnapshot() {
    return this.presence.snapshot((binding) => {
      try {
        this.membership(binding.teamId, binding.membershipId);
        return true;
      } catch {
        return false;
      }
    });
  }
  private async persistSelection(threadId: string) {
    // A fresh legacy thread has no durable rollout until it records an item.
    // Store the actual user-selected team context without inventing a user turn or model reply.
    const session = await this.connection();
    await session.request('thread/inject_items', {
      threadId,
      items: [
        {
          type: 'message',
          role: 'developer',
          content: [
            {
              type: 'input_text',
              text: 'The user selected a team for this chat in Agent Teams. Use tool discovery or the execution wrapper to find agent-teams-runtime.runtime_context and discover your current team and role. Send teammate replies through message_send; ordinary assistant text stays in this chat. Read message_list for received messages.',
            },
          ],
        },
      ],
    });
  }
  tool(token: string, tool: string, input: unknown) {
    const binding = this.store.byToken(token);
    if (!binding?.threadId) throw new Error('Desktop chat credential is invalid or not bound');
    const { team, member } = this.membership(binding.teamId, binding.membershipId);
    if (tool === 'runtime_context' || tool === 'team_membership_list') {
      z.object({}).strict().parse(input);
      return {
        context: {
          scope: 'membership',
          teamId: binding.teamId,
          membershipId: member.membershipId,
          role: member.role,
          threadId: binding.threadId,
        },
        team,
      };
    }
    if (tool === 'message_list') {
      const args = messageListParameters.parse(input);
      return {
        messages: this.store.listForMembership(
          binding.teamId,
          member.membershipId,
          args.unprocessedOnly,
          args.limit
        ),
      };
    }
    if (tool === 'message_get' || tool === 'message_ack') {
      const { messageId } = messageIdParameters.parse(input);
      return {
        message:
          tool === 'message_get'
            ? this.store.readForMembership(messageId, binding.teamId, member.membershipId)
            : this.store.acknowledgeProcessed(messageId, binding.teamId, member.membershipId),
      };
    }
    if (!isTeamCommunicationTool(tool))
      throw new Error('This tool requires an active task assignment');
    const args = teamCommunicationMessage(tool, input, member.membershipId, team?.members);
    const replyTo = decodeTeamReply(args.message).inReplyToMessageId;
    if (replyTo)
      this.store.assertReplyTarget(
        replyTo,
        binding.teamId,
        member.membershipId,
        args.recipientMembershipId
      );
    let message = desktopMessageSchema.parse({
      id: randomUUID(),
      teamId: binding.teamId,
      senderMembershipId: member.membershipId,
      recipientMembershipId: args.recipientMembershipId,
      text: args.message,
      sentAt: new Date().toISOString(),
    });
    if (replyTo) message = this.store.queueReply(message, replyTo);
    else this.store.putMessage(message, 'out');
    this.options.send(message);
    return { messageId: message.id, status: 'queued' };
  }
  hasChat(teamId: string) {
    return this.store.list().some((b) => b.teamId === teamId && b.threadId);
  }
  private scheduleDelivery() {
    if (this.stopped || !this.options.connected()) return;
    if (this.delivery) {
      this.deliveryRequested = true;
      return;
    }
    this.flush();
    this.delivery = this.deliver()
      .catch(() => undefined)
      .finally(() => {
        this.delivery = undefined;
        if (this.deliveryRequested) {
          this.deliveryRequested = false;
          this.scheduleDelivery();
        }
      });
  }
  private async deliver() {
    for (const message of this.store.messages(undefined, true)) {
      try {
        this.membership(message.teamId, message.recipientMembershipId);
      } catch {
        continue;
      }
      const previous = this.store.submissions.get(message.id);
      if (previous) {
        if (
          previous.state === 'accepted' ||
          (await reconcileMessageSubmission(await this.connection(), previous))
        ) {
          this.store.submissions.accept(message.id);
          this.store.acknowledge(message.id);
        }
        continue;
      }
      let binding = this.store
        .list()
        .filter(
          (b) =>
            b.teamId === message.teamId &&
            b.membershipId === message.recipientMembershipId &&
            b.threadId
        )
        .at(-1);
      if (!binding?.threadId) {
        if (this.options.messageDeliveryMode !== 'mcp-inbox') {
          try {
            if (
              await this.options.deliverAssignment?.(message, (threadId, text) =>
                this.store.submissions.begin(message.id, threadId, text)
              )
            ) {
              this.store.submissions.accept(message.id);
              this.store.acknowledge(message.id);
            }
          } catch (error) {
            this.store.submissions.uncertain(message.id, error);
          }
          continue;
        }
        const result = (await this.execute(
          { action: 'open', requestId: message.id, teamId: message.teamId },
          false
        )) as { threadId: string };
        binding = this.store.byThread(result.threadId);
        if (!binding?.threadId) continue;
      }
      const session = await this.connection();
      const read = threadSchema.parse(
        await session.request('thread/read', { threadId: binding.threadId })
      );
      if (read.thread.status?.type === 'active') continue;
      await session.request('thread/resume', {
        threadId: binding.threadId,
        config: await this.config(binding),
      });
      await assertMembershipMcpInventory(session, binding.threadId);
      const text =
        this.options.messageDeliveryMode === 'mcp-inbox'
          ? teamInboxNotification([message.id])
          : [
              `Agent Teams message ${message.id} from membership ${message.senderMembershipId}:`,
              message.text,
              'Show this message to the user. If it asks for a reply, use agent-teams-runtime.message_send to the sender. Do not acknowledge acknowledgements or start unrelated work. Tool discovery and the code execution wrapper for team tools are allowed. Do not use other integrations or shell/file tools. A duplicate message ID must not cause a duplicate reply.',
            ].join('\n\n');
      if (!this.store.submissions.begin(message.id, binding.threadId, text)) continue;
      try {
        await session.request('turn/start', {
          threadId: binding.threadId,
          approvalPolicy: 'on-request',
          sandboxPolicy: { type: 'readOnly' },
          input: [
            {
              type: 'text',
              text,
            },
          ],
        });
        this.store.submissions.accept(message.id);
        this.store.acknowledge(message.id);
      } catch (error) {
        this.store.submissions.uncertain(message.id, error);
        if (await reconcileMessageSubmission(session, this.store.submissions.get(message.id)!)) {
          this.store.submissions.accept(message.id);
          this.store.acknowledge(message.id);
        }
      }
    }
  }
  receive(message: DesktopTeamMessage) {
    this.store.putMessage(desktopMessageSchema.parse(message), 'in');
    this.scheduleDelivery();
  }
  flush() {
    for (const message of this.store.messages(undefined, true, 'out')) this.options.send(message);
  }
  async close() {
    this.stopped = true;
    this.presence.clear();
    clearInterval(this.timer);
    await this.delivery;
    await (await this.session)?.close();
    this.store.close();
  }
}
