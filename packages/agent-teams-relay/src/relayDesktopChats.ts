import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  desktopChatActionSchema,
  desktopMessageAckSchema,
  workerDesktopMessageSchema,
  workerDesktopResultSchema,
  type DesktopTeamMessage,
} from '@claude-teams/agent-teams-protocol';
import type { RelayMembershipRoute } from './relayMembershipRouteStore';

interface DesktopWorker {
  nodeId: string;
  label: string;
  pairingHash?: string;
  send: (value: unknown) => void;
}
export class RelayDesktopChats {
  private db: DatabaseSync;
  private pending = new Map<
    string,
    {
      nodeId: string;
      resolve: (value: unknown) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(
    private options: {
      dataDir: string;
      workers: () => DesktopWorker[];
      memberships: () => readonly RelayMembershipRoute[];
      teamName: (id: string) => string;
    }
  ) {
    this.db = new DatabaseSync(join(options.dataDir, 'desktop-messages.sqlite'));
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, targetNodeId TEXT NOT NULL, payload TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0)'
    );
  }
  register(app: FastifyInstance) {
    app.post('/join/api/desktop', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const parsed = z
        .object({
          pairingCode: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          request: desktopChatActionSchema,
        })
        .strict()
        .safeParse(request.body);
      if (!parsed.success) return reply.code(401).send({ error: 'invalid_device_pairing' });
      const hash = createHash('sha256').update(parsed.data.pairingCode).digest('hex');
      const worker = this.options.workers().find((w) => w.pairingHash === hash);
      if (!worker) return reply.code(401).send({ error: 'device_offline_or_invalid_pairing' });
      const teams = this.options
        .memberships()
        .filter((m) => m.nodeId === worker.nodeId && m.status === 'active')
        .map((m) => ({
          teamId: m.teamId,
          membershipId: m.membershipId,
          name: this.options.teamName(m.teamId),
          role: m.role,
        }));
      const action = parsed.data.request;
      if (action.teamId && !teams.some((t) => t.teamId === action.teamId))
        return reply.code(403).send({ error: 'device_not_in_team' });
      if ([...this.pending.values()].filter((p) => p.nodeId === worker.nodeId).length >= 4)
        return reply.code(429).send({ error: 'device_busy' });
      if (this.pending.has(action.requestId))
        return reply.code(409).send({ error: 'request_in_progress' });
      try {
        const result = await new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pending.delete(action.requestId);
            reject(new Error('Device did not respond; retry with the same request'));
          }, 25000);
          this.pending.set(action.requestId, { nodeId: worker.nodeId, resolve, reject, timer });
          worker.send({ type: 'relay.desktop_control', request: action });
        });
        return { device: { nodeId: worker.nodeId, label: worker.label }, teams, result };
      } catch (error) {
        return reply
          .code(409)
          .send({ error: error instanceof Error ? error.message : 'Device request failed' });
      }
    });
  }
  handle(nodeId: string, input: unknown): boolean {
    const result = workerDesktopResultSchema.safeParse(input);
    if (result.success) {
      const pending = this.pending.get(result.data.requestId);
      if (pending?.nodeId === nodeId) {
        clearTimeout(pending.timer);
        this.pending.delete(result.data.requestId);
        if (result.data.error) pending.reject(new Error(result.data.error));
        else pending.resolve(result.data.result);
      }
      return true;
    }
    const outgoing = workerDesktopMessageSchema.safeParse(input);
    if (outgoing.success) {
      const message = outgoing.data.message;
      const routes = this.options.memberships();
      const sender = routes.find(
        (m) =>
          m.membershipId === message.senderMembershipId &&
          m.nodeId === nodeId &&
          m.teamId === message.teamId &&
          m.status === 'active'
      );
      const recipient = routes.find(
        (m) =>
          m.membershipId === message.recipientMembershipId &&
          m.teamId === message.teamId &&
          m.status === 'active'
      );
      const worker = this.options.workers().find((w) => w.nodeId === nodeId);
      if (!sender || !recipient || sender.membershipId === recipient.membershipId) {
        worker?.send({
          type: 'relay.desktop_message_ack',
          id: message.id,
          error: 'Team membership denied',
        });
        return true;
      }
      const existing = this.db
        .prepare('SELECT payload FROM messages WHERE id=?')
        .get(message.id) as { payload: string } | undefined;
      if (existing && existing.payload !== JSON.stringify(message))
        throw new Error('Message identity conflict');
      this.db
        .prepare('INSERT OR IGNORE INTO messages (id,targetNodeId,payload) VALUES (?,?,?)')
        .run(message.id, recipient.nodeId, JSON.stringify(message));
      worker?.send({ type: 'relay.desktop_message_ack', id: message.id });
      this.flush(recipient.nodeId);
      return true;
    }
    const ack = desktopMessageAckSchema.safeParse(input);
    if (ack.success && ack.data.type === 'worker.desktop_message_ack') {
      this.db
        .prepare('UPDATE messages SET delivered=1 WHERE id=? AND targetNodeId=?')
        .run(ack.data.id, nodeId);
      return true;
    }
    return false;
  }
  flush(nodeId: string) {
    const worker = this.options.workers().find((w) => w.nodeId === nodeId);
    if (!worker?.pairingHash) return;
    const rows = this.db
      .prepare('SELECT payload FROM messages WHERE targetNodeId=? AND delivered=0')
      .all(nodeId) as { payload: string }[];
    for (const row of rows) {
      const message = JSON.parse(row.payload) as DesktopTeamMessage;
      if (
        this.options
          .memberships()
          .some(
            (m) =>
              m.nodeId === nodeId &&
              m.membershipId === message.recipientMembershipId &&
              m.teamId === message.teamId &&
              m.status === 'active'
          )
      )
        worker.send({ type: 'relay.desktop_message', message });
    }
  }
  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Relay restarting'));
    }
    this.pending.clear();
    this.db.close();
  }
}
