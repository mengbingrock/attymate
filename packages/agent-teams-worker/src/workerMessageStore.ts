import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  assignmentIdSchema,
  attemptIdSchema,
  commandIdSchema,
  eventIdSchema,
  teamIdSchema,
  teamMessageDeliveryPayloadSchema,
  type AssignmentId,
  type AttemptId,
  type CommandId,
  type EventId,
  type MembershipId,
  type TeamId,
  type TeamMessageDeliveryPayload,
  type WorkspaceId,
} from '@claude-teams/agent-teams-protocol';

import type { WorkerInboxCommand } from './workerInboxStore';

export type WorkerMessageRoutingState = 'queued' | 'available_active';

export interface WorkerMessageExecutionScope {
  readonly teamId: TeamId;
  readonly membershipId: MembershipId;
  readonly workspaceId: WorkspaceId;
  readonly assignmentId: AssignmentId;
  readonly attemptId: AttemptId;
  readonly leaseEpoch: number;
}

export interface WorkerTeamMessage {
  readonly messageId: EventId;
  readonly deliveryCommandId: CommandId;
  readonly teamId: TeamId;
  readonly assignmentId: AssignmentId;
  readonly attemptId: AttemptId;
  readonly leaseEpoch: number;
  readonly payload: TeamMessageDeliveryPayload;
  readonly routingState: WorkerMessageRoutingState;
  readonly receivedAt: string;
}

interface WorkerTeamMessageRow {
  message_id: string;
  delivery_command_id: string;
  team_id: string;
  assignment_id: string;
  attempt_id: string;
  lease_epoch: number;
  payload_json: string;
  routing_state: WorkerMessageRoutingState;
  received_at: string;
}

const mapRow = (row: WorkerTeamMessageRow): WorkerTeamMessage => ({
  messageId: eventIdSchema.parse(row.message_id),
  deliveryCommandId: commandIdSchema.parse(row.delivery_command_id),
  teamId: teamIdSchema.parse(row.team_id),
  assignmentId: assignmentIdSchema.parse(row.assignment_id),
  attemptId: attemptIdSchema.parse(row.attempt_id),
  leaseEpoch: row.lease_epoch,
  payload: teamMessageDeliveryPayloadSchema.parse(JSON.parse(row.payload_json)),
  routingState: row.routing_state,
  receivedAt: row.received_at,
});

const matchesScope = (
  message: Pick<
    WorkerTeamMessage,
    'teamId' | 'assignmentId' | 'attemptId' | 'leaseEpoch' | 'payload'
  >,
  scope: WorkerMessageExecutionScope | undefined
): boolean =>
  scope !== undefined &&
  message.teamId === scope.teamId &&
  message.assignmentId === scope.assignmentId &&
  message.attemptId === scope.attemptId &&
  message.leaseEpoch === scope.leaseEpoch &&
  message.payload.recipientMembershipId === scope.membershipId &&
  message.payload.recipientWorkspaceId === scope.workspaceId;

export class WorkerMessageConflictError extends Error {
  readonly code = 'WORKER_MESSAGE_CONFLICT';

  constructor(readonly messageId: EventId) {
    super(`Team message ${messageId} was replayed with different content`);
    this.name = 'WorkerMessageConflictError';
  }
}

export class WorkerMessageStore {
  private readonly database: DatabaseSync;

  constructor(dataDir: string) {
    this.database = new DatabaseSync(join(dataDir, 'worker.sqlite'));
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS team_messages (
        message_id TEXT PRIMARY KEY,
        delivery_command_id TEXT NOT NULL UNIQUE,
        team_id TEXT NOT NULL,
        assignment_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        lease_epoch INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        routing_state TEXT NOT NULL CHECK (routing_state IN ('queued', 'available_active')),
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS team_messages_execution_scope
        ON team_messages(team_id, assignment_id, attempt_id, lease_epoch, routing_state);
    `);
  }

  acceptDelivery(
    command: WorkerInboxCommand,
    activeScope?: WorkerMessageExecutionScope
  ): WorkerTeamMessage | undefined {
    if (command.envelope.type !== 'team.message.deliver') return undefined;
    const { teamId, assignmentId, attemptId, leaseEpoch } = command.envelope;
    if (
      teamId === undefined ||
      assignmentId === undefined ||
      attemptId === undefined ||
      leaseEpoch === undefined
    ) {
      throw new TypeError('Team message delivery is missing its execution scope');
    }
    const payload = teamMessageDeliveryPayloadSchema.parse(command.envelope.payload);
    const candidate = {
      teamId,
      assignmentId,
      attemptId,
      leaseEpoch,
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
        existing.assignmentId !== assignmentId ||
        existing.attemptId !== attemptId ||
        existing.leaseEpoch !== leaseEpoch ||
        JSON.stringify(existing.payload) !== JSON.stringify(payload)
      ) {
        throw new WorkerMessageConflictError(payload.messageId);
      }
      return existing;
    }
    const receivedAt = command.receivedAt;
    this.database
      .prepare(
        `INSERT INTO team_messages
          (message_id, delivery_command_id, team_id, assignment_id, attempt_id,
           lease_epoch, payload_json, routing_state, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        payload.messageId,
        command.commandId,
        teamId,
        assignmentId,
        attemptId,
        leaseEpoch,
        JSON.stringify(payload),
        routingState,
        receivedAt
      );
    return this.require(payload.messageId);
  }

  reconcileActiveScope(scope: WorkerMessageExecutionScope): readonly WorkerTeamMessage[] {
    this.database
      .prepare(
        `UPDATE team_messages
         SET routing_state = 'available_active'
         WHERE routing_state = 'queued'
           AND team_id = ? AND assignment_id = ? AND attempt_id = ? AND lease_epoch = ?
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
    return this.listAvailableFor(scope);
  }

  listAvailableFor(scope: WorkerMessageExecutionScope): readonly WorkerTeamMessage[] {
    return this.listAll().filter((message) => matchesScope(message, scope));
  }

  get(inputMessageId: string): WorkerTeamMessage | undefined {
    const messageId = eventIdSchema.parse(inputMessageId);
    const row = this.database
      .prepare('SELECT * FROM team_messages WHERE message_id = ?')
      .get(messageId) as WorkerTeamMessageRow | undefined;
    return row === undefined ? undefined : mapRow(row);
  }

  listAll(): readonly WorkerTeamMessage[] {
    const rows = this.database
      .prepare('SELECT * FROM team_messages ORDER BY received_at ASC, message_id ASC')
      .all() as unknown as WorkerTeamMessageRow[];
    return rows.map(mapRow);
  }

  close(): void {
    this.database.close();
  }

  private require(messageId: EventId): WorkerTeamMessage {
    const message = this.get(messageId);
    if (message === undefined) throw new Error('Worker team message insert did not produce a row');
    return message;
  }
}
