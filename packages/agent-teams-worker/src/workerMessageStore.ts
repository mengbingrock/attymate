import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  assignmentIdSchema,
  attemptIdSchema,
  commandIdSchema,
  eventIdSchema,
  teamIdSchema,
  teamMessageDeliveryPayloadSchema,
  teamMessageEventPayloadSchema,
  type AssignmentId,
  type AttemptId,
  type CommandId,
  type EventId,
  type EventEnvelope,
  type MembershipId,
  type TeamId,
  type TeamMessageDeliveryPayload,
  type WorkspaceId,
} from '@claude-teams/agent-teams-protocol';

import type { WorkerInboxCommand } from './workerInboxStore';
import { decodeTeamReply, MessageReplyStore } from './teamMessageReplies';

export type WorkerMessageRoutingState = 'queued' | 'available_active';
export type WorkerMessageSteerState =
  | 'pending'
  | 'in_flight'
  | 'delivered'
  | 'failed'
  | 'uncertain';

export interface WorkerMessageExecutionScope {
  readonly teamId: TeamId;
  readonly membershipId: MembershipId;
  readonly workspaceId: WorkspaceId;
  readonly assignmentId: AssignmentId;
  readonly attemptId: AttemptId;
  readonly leaseEpoch: number;
}

export interface WorkerMessageSteerIdentity {
  readonly threadId: string;
  readonly turnId: string;
  readonly appServerGeneration: number;
}

export interface WorkerTeamMessage {
  readonly messageId: EventId;
  readonly deliveryCommandId: CommandId;
  readonly teamId: TeamId;
  readonly targetAssignmentId?: AssignmentId;
  readonly targetAttemptId?: AttemptId;
  readonly targetLeaseEpoch?: number;
  readonly payload: TeamMessageDeliveryPayload;
  readonly routingState: WorkerMessageRoutingState;
  readonly steerState: WorkerMessageSteerState;
  readonly steerAttempts: number;
  readonly steerThreadId?: string;
  readonly steerTurnId?: string;
  readonly steerAppServerGeneration?: number;
  readonly lastSteerError?: string;
  readonly steeredAt?: string;
  readonly readAt?: string;
  readonly processedAt?: string;
  readonly repliedAt?: string;
  readonly replyMessageId?: string;
  readonly receivedAt: string;
}

interface WorkerTeamMessageRow {
  message_id: string;
  delivery_command_id: string;
  team_id: string;
  target_assignment_id: string | null;
  target_attempt_id: string | null;
  target_lease_epoch: number | null;
  payload_json: string;
  routing_state: WorkerMessageRoutingState;
  steer_state: WorkerMessageSteerState;
  steer_outcome: 'uncertain' | null;
  steer_attempts: number;
  steer_thread_id: string | null;
  steer_turn_id: string | null;
  steer_app_server_generation: number | null;
  last_steer_error: string | null;
  steered_at: string | null;
  read_at: string | null;
  processed_at: string | null;
  received_at: string;
}

const mapRow = (row: WorkerTeamMessageRow): WorkerTeamMessage => ({
  messageId: eventIdSchema.parse(row.message_id),
  deliveryCommandId: commandIdSchema.parse(row.delivery_command_id),
  teamId: teamIdSchema.parse(row.team_id),
  ...(row.target_assignment_id === null
    ? {}
    : { targetAssignmentId: assignmentIdSchema.parse(row.target_assignment_id) }),
  ...(row.target_attempt_id === null
    ? {}
    : { targetAttemptId: attemptIdSchema.parse(row.target_attempt_id) }),
  ...(row.target_lease_epoch === null ? {} : { targetLeaseEpoch: row.target_lease_epoch }),
  payload: teamMessageDeliveryPayloadSchema.parse(JSON.parse(row.payload_json)),
  routingState: row.routing_state,
  steerState: row.steer_outcome === 'uncertain' ? 'uncertain' : row.steer_state,
  steerAttempts: row.steer_attempts,
  ...(row.steer_thread_id === null ? {} : { steerThreadId: row.steer_thread_id }),
  ...(row.steer_turn_id === null ? {} : { steerTurnId: row.steer_turn_id }),
  ...(row.steer_app_server_generation === null
    ? {}
    : { steerAppServerGeneration: row.steer_app_server_generation }),
  ...(row.last_steer_error === null ? {} : { lastSteerError: row.last_steer_error }),
  ...(row.steered_at === null ? {} : { steeredAt: row.steered_at }),
  ...(row.read_at === null ? {} : { readAt: row.read_at }),
  ...(row.processed_at == null ? {} : { processedAt: row.processed_at }),
  receivedAt: row.received_at,
});

const matchesScope = (
  message: Pick<
    WorkerTeamMessage,
    'teamId' | 'targetAssignmentId' | 'targetAttemptId' | 'targetLeaseEpoch' | 'payload'
  >,
  scope: WorkerMessageExecutionScope | undefined
): boolean =>
  scope !== undefined &&
  message.teamId === scope.teamId &&
  message.targetAssignmentId === scope.assignmentId &&
  message.targetAttemptId === scope.attemptId &&
  message.targetLeaseEpoch === scope.leaseEpoch &&
  message.payload.recipientMembershipId === scope.membershipId &&
  message.payload.recipientWorkspaceId === scope.workspaceId;

export class WorkerMessageConflictError extends Error {
  readonly code = 'WORKER_MESSAGE_CONFLICT';

  constructor(readonly messageId: EventId) {
    super(`Team message ${messageId} was replayed with different content`);
    this.name = 'WorkerMessageConflictError';
  }
}

export class WorkerMessageNotFoundError extends Error {
  readonly code = 'WORKER_MESSAGE_NOT_FOUND';

  constructor(readonly messageId: EventId) {
    super(`Team message ${messageId} was not found`);
    this.name = 'WorkerMessageNotFoundError';
  }
}

export class WorkerMessageStore {
  private readonly database: DatabaseSync;
  private readonly replies: MessageReplyStore;

  constructor(dataDir: string) {
    this.database = new DatabaseSync(join(dataDir, 'worker.sqlite'));
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.replies = new MessageReplyStore(this.database);
    this.migrateLegacySchema();
    this.database.exec(this.createTableSql('team_messages'));
    const columns = this.database.prepare('PRAGMA table_info(team_messages)').all() as {
      name: string;
    }[];
    if (!columns.some(({ name }) => name === 'processed_at'))
      this.database.exec('ALTER TABLE team_messages ADD COLUMN processed_at TEXT');
    if (!columns.some(({ name }) => name === 'steer_outcome'))
      this.database.exec('ALTER TABLE team_messages ADD COLUMN steer_outcome TEXT');
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS team_messages_execution_scope
        ON team_messages(team_id, target_assignment_id, target_attempt_id,
                         target_lease_epoch, routing_state);
      UPDATE team_messages
      SET steer_outcome = 'uncertain', last_steer_error = 'worker_restarted_during_message_steer'
      WHERE steer_state = 'in_flight';
    `);
  }

  acceptDelivery(
    command: WorkerInboxCommand,
    activeScope?: WorkerMessageExecutionScope
  ): WorkerTeamMessage | undefined {
    if (command.envelope.type !== 'team.message.deliver') return undefined;
    const { teamId, assignmentId, attemptId, leaseEpoch } = command.envelope;
    if (teamId === undefined) throw new TypeError('Team message delivery is missing its team');
    const hasTarget =
      assignmentId !== undefined || attemptId !== undefined || leaseEpoch !== undefined;
    if (
      hasTarget &&
      (assignmentId === undefined || attemptId === undefined || leaseEpoch === undefined)
    ) {
      throw new TypeError('Team message delivery has an incomplete target execution scope');
    }
    const payload = teamMessageDeliveryPayloadSchema.parse(command.envelope.payload);
    const candidate = {
      teamId,
      ...(assignmentId === undefined ? {} : { targetAssignmentId: assignmentId }),
      ...(attemptId === undefined ? {} : { targetAttemptId: attemptId }),
      ...(leaseEpoch === undefined ? {} : { targetLeaseEpoch: leaseEpoch }),
      payload,
    };
    const routingState: WorkerMessageRoutingState = matchesScope(candidate, activeScope)
      ? 'available_active'
      : 'queued';
    const existing = this.get(payload.messageId);
    if (existing !== undefined) {
      if (
        existing.deliveryCommandId !== command.commandId ||
        existing.teamId !== teamId ||
        existing.targetAssignmentId !== assignmentId ||
        existing.targetAttemptId !== attemptId ||
        existing.targetLeaseEpoch !== leaseEpoch ||
        JSON.stringify(existing.payload) !== JSON.stringify(payload)
      ) {
        throw new WorkerMessageConflictError(payload.messageId);
      }
      return existing;
    }
    this.database
      .prepare(
        `INSERT INTO team_messages
          (message_id, delivery_command_id, team_id, target_assignment_id, target_attempt_id,
           target_lease_epoch, payload_json, routing_state, steer_state, steer_attempts,
           received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`
      )
      .run(
        payload.messageId,
        command.commandId,
        teamId,
        assignmentId ?? null,
        attemptId ?? null,
        leaseEpoch ?? null,
        JSON.stringify(payload),
        routingState,
        command.receivedAt
      );
    return this.require(payload.messageId);
  }

  reconcileActiveScope(
    scope: WorkerMessageExecutionScope,
    includeRead = false
  ): readonly WorkerTeamMessage[] {
    this.database
      .prepare(
        `UPDATE team_messages
         SET routing_state = 'available_active'
         WHERE routing_state = 'queued'
           AND team_id = ? AND target_assignment_id = ?
           AND target_attempt_id = ? AND target_lease_epoch = ?
           AND json_extract(payload_json, '$.recipientMembershipId') = ?
           AND json_extract(payload_json, '$.recipientWorkspaceId') = ?`
      )
      .run(
        scope.teamId,
        scope.assignmentId,
        scope.attemptId,
        scope.leaseEpoch,
        scope.membershipId,
        scope.workspaceId
      );
    return this.listPendingFor(scope, includeRead);
  }

  listPendingFor(
    scope: WorkerMessageExecutionScope,
    includeRead = false
  ): readonly WorkerTeamMessage[] {
    return this.listAll().filter(
      (message) =>
        matchesScope(message, scope) &&
        ['pending', 'failed'].includes(message.steerState) &&
        (includeRead || message.readAt === undefined) &&
        message.processedAt === undefined
    );
  }

  beginSteer(
    inputMessageId: string,
    scope: WorkerMessageExecutionScope,
    identity: WorkerMessageSteerIdentity,
    includeRead = false
  ): WorkerTeamMessage | undefined {
    const message = this.get(inputMessageId);
    if (
      message === undefined ||
      !matchesScope(message, scope) ||
      (!includeRead && message.readAt !== undefined) ||
      message.processedAt !== undefined
    ) {
      return undefined;
    }
    const result = this.database
      .prepare(
        `UPDATE team_messages
         SET steer_state = 'in_flight', steer_attempts = steer_attempts + 1,
             steer_thread_id = ?, steer_turn_id = ?, steer_app_server_generation = ?,
             last_steer_error = NULL
         WHERE message_id = ? AND steer_state IN ('pending', 'failed')
           AND steer_outcome IS NULL AND processed_at IS NULL`
      )
      .run(identity.threadId, identity.turnId, identity.appServerGeneration, message.messageId);
    return result.changes === 0 ? undefined : this.require(message.messageId);
  }

  markSteered(
    inputMessageId: string,
    identity: WorkerMessageSteerIdentity,
    markRead = true
  ): WorkerTeamMessage {
    const messageId = eventIdSchema.parse(inputMessageId);
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        `UPDATE team_messages
         SET steer_state = 'delivered', steer_outcome = NULL, steered_at = ?, read_at = COALESCE(read_at, ?), last_steer_error = NULL
         WHERE message_id = ? AND steer_state = 'in_flight'
           AND steer_thread_id = ? AND steer_turn_id = ?
           AND steer_app_server_generation = ?`
      )
      .run(
        now,
        markRead ? now : null,
        messageId,
        identity.threadId,
        identity.turnId,
        identity.appServerGeneration
      );
    if (result.changes === 0) throw new Error(`Team message ${messageId} steer claim is stale`);
    return this.require(messageId);
  }

  markSteerFailed(
    inputMessageId: string,
    identity: WorkerMessageSteerIdentity,
    error: string
  ): WorkerTeamMessage {
    const messageId = eventIdSchema.parse(inputMessageId);
    this.database
      .prepare(
        `UPDATE team_messages
         SET steer_state = 'failed', last_steer_error = ?
         WHERE message_id = ? AND steer_state = 'in_flight'
           AND steer_thread_id = ? AND steer_turn_id = ?
           AND steer_app_server_generation = ?`
      )
      .run(
        error.slice(0, 2_000),
        messageId,
        identity.threadId,
        identity.turnId,
        identity.appServerGeneration
      );
    return this.require(messageId);
  }

  /** The RPC may have been accepted. Preserve its claim and require positive reconciliation. */
  markSteerUncertain(
    inputMessageId: string,
    identity: WorkerMessageSteerIdentity,
    error: string
  ): WorkerTeamMessage {
    const messageId = eventIdSchema.parse(inputMessageId);
    this.database
      .prepare(
        `UPDATE team_messages SET steer_outcome='uncertain', last_steer_error=?
      WHERE message_id=? AND steer_state='in_flight' AND steer_thread_id=?
      AND steer_turn_id=? AND steer_app_server_generation=?`
      )
      .run(
        error.slice(0, 2000),
        messageId,
        identity.threadId,
        identity.turnId,
        identity.appServerGeneration
      );
    return this.require(messageId);
  }

  markRead(inputMessageId: string): WorkerTeamMessage {
    const messageId = eventIdSchema.parse(inputMessageId);
    const result = this.database
      .prepare('UPDATE team_messages SET read_at = COALESCE(read_at, ?) WHERE message_id = ?')
      .run(new Date().toISOString(), messageId);
    if (result.changes === 0) throw new WorkerMessageNotFoundError(messageId);
    return this.require(messageId);
  }

  requeueUnprocessedNotifications(): void {
    // Accepted notifications remain delivered. Processing receipts are independent; replaying
    // an accepted turn after restart can execute or reply twice before message_ack persists.
  }

  listForScope(
    scope: WorkerMessageExecutionScope,
    unprocessedOnly = false,
    limit = 50
  ): readonly WorkerTeamMessage[] {
    return this.listAll()
      .filter(
        (message) =>
          matchesScope(message, scope) && (!unprocessedOnly || message.processedAt === undefined)
      )
      .slice(0, limit);
  }

  readForScope(inputMessageId: string, scope: WorkerMessageExecutionScope): WorkerTeamMessage {
    const message = this.get(inputMessageId);
    if (!message || !matchesScope(message, scope))
      throw new WorkerMessageNotFoundError(eventIdSchema.parse(inputMessageId));
    return this.markRead(message.messageId);
  }

  acknowledgeForScope(
    inputMessageId: string,
    scope: WorkerMessageExecutionScope
  ): WorkerTeamMessage {
    const message = this.readForScope(inputMessageId, scope);
    this.database
      .prepare(
        'UPDATE team_messages SET processed_at = COALESCE(processed_at, ?) WHERE message_id = ?'
      )
      .run(new Date().toISOString(), message.messageId);
    return this.require(message.messageId);
  }

  get(inputMessageId: string): WorkerTeamMessage | undefined {
    const messageId = eventIdSchema.parse(inputMessageId);
    const row = this.database
      .prepare('SELECT * FROM team_messages WHERE message_id = ?')
      .get(messageId) as WorkerTeamMessageRow | undefined;
    return row === undefined ? undefined : { ...mapRow(row), ...this.replies.get(row.message_id) };
  }

  listAll(): readonly WorkerTeamMessage[] {
    const rows = this.database
      .prepare('SELECT * FROM team_messages ORDER BY received_at ASC, message_id ASC')
      .all() as unknown as WorkerTeamMessageRow[];
    return rows.map((row) => ({ ...mapRow(row), ...this.replies.get(row.message_id) }));
  }

  assertReplyTarget(id: string, scope: WorkerMessageExecutionScope, recipient: string): void {
    const message = this.get(id);
    if (
      !message ||
      !matchesScope(message, scope) ||
      message.payload.senderMembershipId !== recipient
    )
      throw new Error(
        'Reply target was not found in this execution inbox or has a different sender'
      );
  }

  /** Rebuildable from durable outbox events, including a crash before this local projection. */
  recordReplyFromOutbox(envelope: EventEnvelope): void {
    if (envelope.type !== 'team.message') return;
    const payload = teamMessageEventPayloadSchema.parse(envelope.payload);
    const replyTo = decodeTeamReply(payload.message).inReplyToMessageId;
    if (
      !replyTo ||
      !envelope.teamId ||
      !envelope.assignmentId ||
      !envelope.attemptId ||
      envelope.leaseEpoch === undefined
    )
      return;
    this.assertReplyTarget(
      replyTo,
      {
        teamId: envelope.teamId,
        assignmentId: envelope.assignmentId,
        attemptId: envelope.attemptId,
        leaseEpoch: envelope.leaseEpoch,
        membershipId: payload.senderMembershipId,
        workspaceId: payload.senderWorkspaceId,
      },
      payload.recipientMembershipId
    );
    this.replies.record(replyTo, envelope.eventId, envelope.occurredAt);
  }

  close(): void {
    this.database.close();
  }

  private migrateLegacySchema(): void {
    const columns = this.database.prepare('PRAGMA table_info(team_messages)').all() as Array<{
      name: string;
    }>;
    if (columns.length === 0 || columns.some(({ name }) => name === 'target_assignment_id')) {
      return;
    }
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database.exec(this.createTableSql('team_messages_next'));
      this.database.exec(`
        INSERT INTO team_messages_next (
          message_id, delivery_command_id, team_id, target_assignment_id, target_attempt_id,
          target_lease_epoch, payload_json, routing_state, steer_state, steer_attempts,
          received_at
        )
        SELECT message_id, delivery_command_id, team_id,
               CASE WHEN routing_state = 'available_active' THEN assignment_id END,
               CASE WHEN routing_state = 'available_active' THEN attempt_id END,
               CASE WHEN routing_state = 'available_active' THEN lease_epoch END,
               json_set(payload_json,
                 '$.sourceAssignmentId', assignment_id,
                 '$.sourceAttemptId', attempt_id,
                 '$.sourceLeaseEpoch', lease_epoch),
               routing_state, 'pending', 0, received_at
        FROM team_messages;
        DROP TABLE team_messages;
        ALTER TABLE team_messages_next RENAME TO team_messages;
      `);
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  private createTableSql(name: string): string {
    return `
      CREATE TABLE IF NOT EXISTS ${name} (
        message_id TEXT PRIMARY KEY,
        delivery_command_id TEXT NOT NULL UNIQUE,
        team_id TEXT NOT NULL,
        target_assignment_id TEXT,
        target_attempt_id TEXT,
        target_lease_epoch INTEGER,
        payload_json TEXT NOT NULL,
        routing_state TEXT NOT NULL CHECK (routing_state IN ('queued', 'available_active')),
        steer_state TEXT NOT NULL CHECK (steer_state IN ('pending', 'in_flight', 'delivered', 'failed')),
        steer_attempts INTEGER NOT NULL,
        steer_thread_id TEXT,
        steer_turn_id TEXT,
        steer_app_server_generation INTEGER,
        last_steer_error TEXT,
        steered_at TEXT,
        read_at TEXT,
        processed_at TEXT,
        received_at TEXT NOT NULL,
        CHECK (
          (target_assignment_id IS NULL AND target_attempt_id IS NULL AND target_lease_epoch IS NULL)
          OR
          (target_assignment_id IS NOT NULL AND target_attempt_id IS NOT NULL AND target_lease_epoch IS NOT NULL)
        )
      );
    `;
  }

  private require(messageId: EventId): WorkerTeamMessage {
    const message = this.get(messageId);
    if (message === undefined) throw new Error('Worker team message insert did not produce a row');
    return message;
  }
}
