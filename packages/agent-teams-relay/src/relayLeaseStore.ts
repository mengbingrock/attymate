import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  assignmentIdSchema,
  attemptIdSchema,
  commandEnvelopeSchema,
  leaseIdSchema,
  nodeIdSchema,
  teamIdSchema,
  type AssignmentId,
  type AttemptId,
  type CommandEnvelope,
  type LeaseId,
  type NodeId,
  type TeamId,
} from '@claude-teams/agent-teams-protocol';

export type RelayLeaseStatus = 'granted' | 'active' | 'expired' | 'released';

export interface RelayLeaseRecord {
  readonly leaseId: LeaseId;
  readonly assignmentId: AssignmentId;
  readonly attemptId: AttemptId;
  readonly nodeId: NodeId;
  readonly teamId?: TeamId;
  readonly leaseEpoch: number;
  readonly assignmentRevision: number;
  readonly status: RelayLeaseStatus;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly updatedAt: string;
}

export interface RelayLeaseGrant {
  readonly lease: RelayLeaseRecord;
  readonly command: CommandEnvelope;
}

interface RelayLeaseRow {
  lease_id: string;
  assignment_id: string;
  attempt_id: string;
  node_id: string;
  team_id: string | null;
  lease_epoch: number;
  assignment_revision: number;
  status: RelayLeaseStatus;
  issued_at: string;
  expires_at: string;
  updated_at: string;
}

const mapRow = (row: RelayLeaseRow): RelayLeaseRecord => ({
  leaseId: leaseIdSchema.parse(row.lease_id),
  assignmentId: assignmentIdSchema.parse(row.assignment_id),
  attemptId: attemptIdSchema.parse(row.attempt_id),
  nodeId: nodeIdSchema.parse(row.node_id),
  ...(row.team_id === null ? {} : { teamId: teamIdSchema.parse(row.team_id) }),
  leaseEpoch: row.lease_epoch,
  assignmentRevision: row.assignment_revision,
  status: row.status,
  issuedAt: row.issued_at,
  expiresAt: row.expires_at,
  updatedAt: row.updated_at,
});

export class RelayLeaseStore {
  private readonly database: DatabaseSync;
  private lastCommandSequence = Date.now();

  constructor(
    dataDir: string,
    private readonly leaseDurationMs = 90_000
  ) {
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs <= 0) {
      throw new TypeError('leaseDurationMs must be a positive integer');
    }
    this.database = new DatabaseSync(join(dataDir, 'relay.sqlite'));
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS relay_execution_leases (
        lease_id TEXT PRIMARY KEY,
        assignment_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL UNIQUE,
        node_id TEXT NOT NULL,
        team_id TEXT,
        lease_epoch INTEGER NOT NULL,
        assignment_revision INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('granted', 'active', 'expired', 'released')),
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS relay_execution_leases_node_active
        ON relay_execution_leases(node_id)
        WHERE status IN ('granted', 'active');
      CREATE INDEX IF NOT EXISTS relay_execution_leases_assignment_epoch
        ON relay_execution_leases(assignment_id, lease_epoch);
    `);
  }

  grantIfCapacity(input: {
    readonly assignmentId: string;
    readonly assignmentRevision: number;
    readonly nodeId: string;
    readonly teamId?: string;
  }): RelayLeaseGrant | undefined {
    const assignmentId = assignmentIdSchema.parse(input.assignmentId);
    const nodeId = nodeIdSchema.parse(input.nodeId);
    const teamId = input.teamId === undefined ? undefined : teamIdSchema.parse(input.teamId);
    if (!Number.isInteger(input.assignmentRevision) || input.assignmentRevision < 0) {
      throw new TypeError('assignmentRevision must be a non-negative integer');
    }
    const now = new Date();
    this.expireThrough(now);
    const currentNodeLease = this.database
      .prepare(
        `SELECT * FROM relay_execution_leases
         WHERE node_id = ? AND status IN ('granted', 'active')`
      )
      .get(nodeId) as RelayLeaseRow | undefined;
    if (currentNodeLease !== undefined) return undefined;

    const existingAssignmentLease = this.database
      .prepare(
        `SELECT * FROM relay_execution_leases
         WHERE assignment_id = ? AND status IN ('granted', 'active')`
      )
      .get(assignmentId) as RelayLeaseRow | undefined;
    if (existingAssignmentLease !== undefined) return undefined;

    const epochRow = this.database
      .prepare(
        'SELECT COALESCE(MAX(lease_epoch), 0) AS lease_epoch FROM relay_execution_leases WHERE assignment_id = ?'
      )
      .get(assignmentId) as { lease_epoch: number };
    const leaseEpoch = epochRow.lease_epoch + 1;
    const leaseId = leaseIdSchema.parse(randomUUID());
    const attemptId = attemptIdSchema.parse(randomUUID());
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.leaseDurationMs).toISOString();
    this.database
      .prepare(
        `INSERT INTO relay_execution_leases
          (lease_id, assignment_id, attempt_id, node_id, team_id, lease_epoch,
           assignment_revision, status, issued_at, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'granted', ?, ?, ?)`
      )
      .run(
        leaseId,
        assignmentId,
        attemptId,
        nodeId,
        teamId ?? null,
        leaseEpoch,
        input.assignmentRevision,
        issuedAt,
        expiresAt,
        issuedAt
      );
    const lease = this.get(leaseId);
    if (lease === undefined) throw new Error('Relay lease insert did not produce a row');
    this.lastCommandSequence = Math.max(this.lastCommandSequence + 1, Date.now());
    const command = commandEnvelopeSchema.parse({
      protocolVersion: 2,
      commandId: randomUUID(),
      sequence: this.lastCommandSequence,
      ...(teamId === undefined ? {} : { teamId }),
      targetNodeId: nodeId,
      assignmentId,
      attemptId,
      leaseEpoch,
      expiresAt,
      type: 'assignment.lease_grant',
      payload: { leaseId, assignmentRevision: input.assignmentRevision },
    });
    return { lease, command };
  }

  markActive(assignmentId: string, attemptId: string, leaseEpoch: number): void {
    this.database
      .prepare(
        `UPDATE relay_execution_leases
         SET status = 'active', updated_at = ?
         WHERE assignment_id = ? AND attempt_id = ? AND lease_epoch = ? AND status = 'granted'`
      )
      .run(
        new Date().toISOString(),
        assignmentIdSchema.parse(assignmentId),
        attemptIdSchema.parse(attemptId),
        leaseEpoch
      );
  }

  release(assignmentId: string, attemptId?: string, leaseEpoch?: number): void {
    const normalizedAssignmentId = assignmentIdSchema.parse(assignmentId);
    const now = new Date().toISOString();
    if (attemptId !== undefined && leaseEpoch !== undefined) {
      this.database
        .prepare(
          `UPDATE relay_execution_leases
           SET status = 'released', updated_at = ?
           WHERE assignment_id = ? AND attempt_id = ? AND lease_epoch = ?
             AND status IN ('granted', 'active')`
        )
        .run(now, normalizedAssignmentId, attemptIdSchema.parse(attemptId), leaseEpoch);
      return;
    }
    this.database
      .prepare(
        `UPDATE relay_execution_leases
         SET status = 'released', updated_at = ?
         WHERE assignment_id = ? AND status IN ('granted', 'active')`
      )
      .run(now, normalizedAssignmentId);
  }

  expireThrough(now = new Date()): void {
    this.database
      .prepare(
        `UPDATE relay_execution_leases
         SET status = 'expired', updated_at = ?
         WHERE status IN ('granted', 'active') AND expires_at <= ?`
      )
      .run(now.toISOString(), now.toISOString());
  }

  get(leaseId: LeaseId): RelayLeaseRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM relay_execution_leases WHERE lease_id = ?')
      .get(leaseId) as RelayLeaseRow | undefined;
    return row === undefined ? undefined : mapRow(row);
  }

  listAll(): readonly RelayLeaseRecord[] {
    const rows = this.database
      .prepare('SELECT * FROM relay_execution_leases ORDER BY issued_at ASC, lease_id ASC')
      .all() as unknown as RelayLeaseRow[];
    return rows.map(mapRow);
  }

  close(): void {
    this.database.close();
  }
}
