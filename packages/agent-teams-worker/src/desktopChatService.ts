import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
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
import { DesktopChatStore, type DesktopChatBinding } from './desktopChatStore';

const threadSchema = z.object({
  thread: z.object({ id: z.string(), status: z.object({ type: z.string() }).optional() }),
});
export const DESKTOP_TEAM_TOOLS = [
  'runtime_context',
  'team_membership_list',
  'message_send',
  'message_list',
] as const;

/** A membership-scoped chat, deliberately independent of task execution leases. */
export class DesktopChatService {
  readonly store: DesktopChatStore;
  private session?: Promise<WorkerCodexAppServerSession>;
  private delivery?: Promise<void>;
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
      deliverAssignment?: (message: DesktopTeamMessage) => Promise<boolean>;
    }
  ) {
    this.store = new DesktopChatStore(options.dataDir);
    this.timer = setInterval(() => this.scheduleDelivery(), 3000);
    this.timer.unref();
  }

  private async connection(): Promise<WorkerCodexAppServerSession> {
    this.session ??= this.options.factory
      .open()
      .then((session) => {
        session.onClose(() => {
          this.session = undefined;
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
  private config(binding: DesktopChatBinding) {
    this.membership(binding.teamId, binding.membershipId);
    return {
      mcp_servers: {
        'agent-teams-runtime': {
          command: this.options.mcp.command,
          args: [...this.options.mcp.args, '--desktop-chat'],
          env: { AGENT_TEAMS_RUNTIME_SESSION_TOKEN: binding.token },
          enabled: true,
          required: true,
          startup_timeout_sec: 15,
          enabled_tools: [...DESKTOP_TEAM_TOOLS],
          default_tools_approval_mode: 'approve',
        },
      },
    };
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
  private async execute(request: z.infer<typeof desktopChatActionSchema>) {
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
        config: this.config(binding),
      });
    } else if (!binding.threadId) {
      const cwd = join(this.options.dataDir, 'team-chat-workspaces', binding.id);
      await mkdir(cwd, { recursive: true, mode: 0o700 });
      const result = threadSchema.parse(
        await session.request('thread/start', {
          cwd,
          ephemeral: false,
          approvalPolicy: 'on-request',
          sandbox: 'read-only',
          config: this.config(binding),
          developerInstructions:
            'This is a persistent Agent Teams chat. Use tool discovery or the code execution wrapper when needed to find agent-teams-runtime tools. Call runtime_context to discover your team and role. Use message_send to communicate with teammates; ordinary assistant text stays in this chat. Read message_list for incoming messages. Do not claim a task result without an active assignment.',
        })
      );
      this.store.bind(binding.id, result.thread.id);
      await this.persistSelection(result.thread.id);
      await session.request('thread/name/set', {
        threadId: result.thread.id,
        name: `Team chat — ${member.label}`,
      });
    }
    binding = this.store.get(binding.id)!;
    let desktopOpened = false;
    if (binding.threadId && this.options.openDesktop) {
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
  prepare(input: unknown) {
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
    return binding ? { bindingId: binding.id, config: this.config(binding) } : {};
  }
  async bind(input: unknown) {
    const p = z
      .object({ bindingId: z.uuid(), threadId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/) })
      .strict()
      .parse(input);
    this.store.bind(p.bindingId, p.threadId);
    await this.persistSelection(p.threadId);
    return { ok: true };
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
      z.object({}).strict().parse(input);
      return { messages: this.store.messages(binding.teamId) };
    }
    if (tool !== 'message_send') throw new Error('This tool requires an active task assignment');
    const args = z
      .object({ recipientMembershipId: z.uuid(), message: z.string().trim().min(1).max(20000) })
      .strict()
      .parse(input);
    if (
      args.recipientMembershipId === member.membershipId ||
      !team?.members.some(
        (m) => m.membershipId === args.recipientMembershipId && m.status === 'active'
      )
    )
      throw new Error('Recipient must be another active member of this team');
    const message = desktopMessageSchema.parse({
      id: randomUUID(),
      teamId: binding.teamId,
      senderMembershipId: member.membershipId,
      recipientMembershipId: args.recipientMembershipId,
      text: args.message,
      sentAt: new Date().toISOString(),
    });
    this.store.putMessage(message, 'out');
    this.options.send(message);
    return { messageId: message.id, status: 'queued' };
  }
  hasChat(teamId: string) {
    return this.store.list().some((b) => b.teamId === teamId && b.threadId);
  }
  private scheduleDelivery() {
    if (this.stopped || this.delivery || !this.options.connected()) return;
    this.flush();
    this.delivery = this.deliver()
      .catch(() => undefined)
      .finally(() => {
        this.delivery = undefined;
      });
  }
  private async deliver() {
    for (const message of this.store.messages(undefined, true)) {
      try {
        this.membership(message.teamId, message.recipientMembershipId);
      } catch {
        continue;
      }
      const binding = this.store
        .list()
        .filter(
          (b) =>
            b.teamId === message.teamId &&
            b.membershipId === message.recipientMembershipId &&
            b.threadId
        )
        .at(-1);
      if (!binding?.threadId) {
        if (await this.options.deliverAssignment?.(message)) this.store.acknowledge(message.id);
        continue;
      }
      const session = await this.connection();
      const read = threadSchema.parse(
        await session.request('thread/read', { threadId: binding.threadId })
      );
      if (read.thread.status?.type === 'active') continue;
      await session.request('thread/resume', {
        threadId: binding.threadId,
        config: this.config(binding),
      });
      await session.request('turn/start', {
        threadId: binding.threadId,
        approvalPolicy: 'on-request',
        sandboxPolicy: { type: 'readOnly' },
        input: [
          {
            type: 'text',
            text: [
              `Agent Teams message ${message.id} from membership ${message.senderMembershipId}:`,
              message.text,
              'Show this message to the user. If it asks for a reply, use agent-teams-runtime.message_send to the sender. Do not acknowledge acknowledgements or start unrelated work. Tool discovery and the code execution wrapper for team tools are allowed. Do not use other integrations or shell/file tools. A duplicate message ID must not cause a duplicate reply.',
            ].join('\n\n'),
          },
        ],
      });
      this.store.acknowledge(message.id);
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
    clearInterval(this.timer);
    await this.delivery;
    await (await this.session)?.close();
    this.store.close();
  }
}
