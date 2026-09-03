import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  assignmentIdSchema,
  attemptIdSchema,
  leaseIdSchema,
  membershipIdSchema,
  mcpSessionContextSchema,
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  teamIdSchema,
  workerInstanceIdSchema,
  workspaceIdSchema,
  type RuntimeSessionContext,
  type TeamMembershipRole,
} from '@claude-teams/agent-teams-protocol';

export interface RuntimeMcpSessionIdentity {
  readonly organizationId: string;
  readonly personId: string;
  readonly nodeId: string;
  readonly workerInstanceId: string;
  readonly teamId: string;
  readonly membershipId: string;
  readonly assignmentId: string;
  readonly attemptId: string;
  readonly workspaceId: string;
  readonly teamRole?: TeamMembershipRole;
  readonly leaseEpoch: number;
  readonly leaseId: string;
  readonly expiresAt: string;
}

export interface CreatedRuntimeMcpSession {
  readonly token: string;
  readonly expiresAt: string;
  readonly teamRole: TeamMembershipRole;
}

interface RuntimeSessionRow {
  token_hash: string;
  organization_id: string;
  person_id: string;
  node_id: string;
  worker_instance_id: string;
  team_id: string;
  membership_id: string;
  assignment_id: string;
  attempt_id: string;
  workspace_id: string;
  team_role: string;
  lease_epoch: number;
  lease_id: string;
  turn_id: string | null;
  expires_at: string;
  revoked_at: string | null;
}

interface AuthorizedRuntimeSessionRow extends RuntimeSessionRow {
  binding_state: string;
  binding_turn_id: string | null;
  binding_lease_epoch: number;
  binding_lease_id: string;
}

const tokenHash = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const normalizeExpiry = (value: string): string => {
  const expiry = new Date(value);
  if (!Number.isFinite(expiry.getTime())) throw new TypeError('expiresAt must be a timestamp');
  return expiry.toISOString();
};

const validateIdentity = (input: RuntimeMcpSessionIdentity): RuntimeMcpSessionIdentity => ({
  organizationId: organizationIdSchema.parse(input.organizationId),
  personId: personIdSchema.parse(input.personId),
  nodeId: nodeIdSchema.parse(input.nodeId),
  workerInstanceId: workerInstanceIdSchema.parse(input.workerInstanceId),
  teamId: teamIdSchema.parse(input.teamId),
  membershipId: membershipIdSchema.parse(input.membershipId),
  assignmentId: assignmentIdSchema.parse(input.assignmentId),
  attemptId: attemptIdSchema.parse(input.attemptId),
  workspaceId: workspaceIdSchema.parse(input.workspaceId),
  teamRole: input.teamRole ?? 'member',
  leaseEpoch: input.leaseEpoch,
  leaseId: leaseIdSchema.parse(input.leaseId),
  expiresAt: normalizeExpiry(input.expiresAt),
});

export class RuntimeMcpSessionAuthorizationError extends Error {
  readonly code = 'RUNTIME_MCP_SESSION_DENIED';

  constructor(message = 'Runtime MCP session is invalid, expired, fenced, or not turn-bound') {
    super(message);
    this.name = 'RuntimeMcpSessionAuthorizationError';
  }
}

export class WorkerRuntimeSessionStore {
  private readonly database: DatabaseSync;

  constructor(dataDir: string) {
    this.database = new DatabaseSync(join(dataDir, 'worker.sqlite'));
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS runtime_mcp_sessions (
        token_hash TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        worker_instance_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        membership_id TEXT NOT NULL,
        assignment_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        team_role TEXT NOT NULL DEFAULT 'member',
        lease_epoch INTEGER NOT NULL,
        lease_id TEXT NOT NULL,
        turn_id TEXT,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS runtime_mcp_sessions_one_active_attempt
        ON runtime_mcp_sessions(attempt_id) WHERE revoked_at IS NULL;
    `);
    this.ensureColumn('team_role', "TEXT NOT NULL DEFAULT 'member'");
  }

  create(input: RuntimeMcpSessionIdentity): CreatedRuntimeMcpSession {
    const identity = validateIdentity(input);
    if (!Number.isInteger(identity.leaseEpoch) || identity.leaseEpoch <= 0) {
      throw new TypeError('leaseEpoch must be a positive integer');
    }
    if (new Date(identity.expiresAt).getTime() <= Date.now()) {
      throw new RuntimeMcpSessionAuthorizationError('Cannot create an already-expired session');
    }
    const token = randomBytes(32).toString('base64url');
    const hash = tokenHash(token);
    const teamRole = identity.teamRole ?? 'member';
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database
        .prepare(
          `UPDATE runtime_mcp_sessions SET revoked_at = ?, updated_at = ?
           WHERE attempt_id = ? AND revoked_at IS NULL`
        )
        .run(now, now, identity.attemptId);
      this.database
        .prepare(
          `INSERT INTO runtime_mcp_sessions
            (token_hash, organization_id, person_id, node_id, worker_instance_id, team_id,
             membership_id, assignment_id, attempt_id, workspace_id, team_role, lease_epoch, lease_id,
             expires_at,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          hash,
          identity.organizationId,
          identity.personId,
          identity.nodeId,
          identity.workerInstanceId,
          identity.teamId,
          identity.membershipId,
          identity.assignmentId,
          identity.attemptId,
          identity.workspaceId,
          teamRole,
          identity.leaseEpoch,
          identity.leaseId,
          identity.expiresAt,
          now,
          now
        );
      this.database.exec('COMMIT;');
      return { token, expiresAt: identity.expiresAt, teamRole };
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  rotateAttempt(attemptIdInput: string, expiresAtInput?: string): CreatedRuntimeMcpSession {
    const attemptId = attemptIdSchema.parse(attemptIdInput);
    const row = this.database
      .prepare(
        `SELECT * FROM runtime_mcp_sessions
         WHERE attempt_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(attemptId) as RuntimeSessionRow | undefined;
    if (row === undefined) throw new RuntimeMcpSessionAuthorizationError();
    return this.create({
      organizationId: row.organization_id,
      personId: row.person_id,
      nodeId: row.node_id,
      workerInstanceId: row.worker_instance_id,
      teamId: row.team_id,
      membershipId: row.membership_id,
      assignmentId: row.assignment_id,
      attemptId: row.attempt_id,
      workspaceId: row.workspace_id,
      teamRole: row.team_role as TeamMembershipRole,
      leaseEpoch: row.lease_epoch,
      leaseId: row.lease_id,
      expiresAt: expiresAtInput === undefined ? row.expires_at : normalizeExpiry(expiresAtInput),
    });
  }

  bindTurn(token: string, turnId: string): void {
    const normalizedTurnId = turnId.trim();
    if (normalizedTurnId.length === 0 || normalizedTurnId.length > 256) {
      throw new TypeError('turnId must contain 1-256 characters');
    }
    const result = this.database
      .prepare(
        `UPDATE runtime_mcp_sessions SET turn_id = ?, updated_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`
      )
      .run(
        normalizedTurnId,
        new Date().toISOString(),
        tokenHash(token),
        new Date().toISOString()
      );
    if (result.changes !== 1) throw new RuntimeMcpSessionAuthorizationError();
  }

  renewAttempt(attemptIdInput: string, expiresAtInput: string): void {
    const attemptId = attemptIdSchema.parse(attemptIdInput);
    const expiresAt = normalizeExpiry(expiresAtInput);
    this.database
      .prepare(
        `UPDATE runtime_mcp_sessions SET expires_at = ?, updated_at = ?
         WHERE attempt_id = ? AND revoked_at IS NULL`
      )
      .run(expiresAt, new Date().toISOString(), attemptId);
  }

  revokeAttempt(attemptIdInput: string): void {
    const attemptId = attemptIdSchema.parse(attemptIdInput);
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE runtime_mcp_sessions SET revoked_at = ?, updated_at = ?
         WHERE attempt_id = ? AND revoked_at IS NULL`
      )
      .run(now, now, attemptId);
  }

  authorize(token: string): RuntimeSessionContext {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new RuntimeMcpSessionAuthorizationError();
    const row = this.database
      .prepare(
        `SELECT sessions.*, bindings.state AS binding_state,
                bindings.turn_id AS binding_turn_id,
                bindings.lease_epoch AS binding_lease_epoch,
                bindings.lease_id AS binding_lease_id
         FROM runtime_mcp_sessions AS sessions
         JOIN runtime_bindings AS bindings ON bindings.attempt_id = sessions.attempt_id
         WHERE sessions.token_hash = ?`
      )
      .get(tokenHash(token)) as AuthorizedRuntimeSessionRow | undefined;
    if (
      row === undefined ||
      row.revoked_at !== null ||
      row.turn_id === null ||
      row.expires_at <= new Date().toISOString() ||
      row.binding_state !== 'active' ||
      row.binding_turn_id !== row.turn_id ||
      row.binding_lease_epoch !== row.lease_epoch ||
      row.binding_lease_id !== row.lease_id
    ) {
      throw new RuntimeMcpSessionAuthorizationError();
    }
    return mcpSessionContextSchema.parse({
      protocolVersion: 2,
      coordinationMode: 'lan_relay_v2',
      profile: 'agent-teams-runtime',
      organizationId: row.organization_id,
      personId: row.person_id,
      nodeId: row.node_id,
      workerInstanceId: row.worker_instance_id,
      teamId: row.team_id,
      membershipId: row.membership_id,
      assignmentId: row.assignment_id,
      attemptId: row.attempt_id,
      workspaceId: row.workspace_id,
      teamRole: row.team_role,
      leaseEpoch: row.lease_epoch,
      turnId: row.turn_id,
    }) as RuntimeSessionContext;
  }

  close(): void {
    this.database.close();
  }

  private ensureColumn(name: string, definition: string): void {
    const columns = this.database.prepare('PRAGMA table_info(runtime_mcp_sessions)').all() as Array<{
      name: string;
    }>;
    if (columns.some((column) => column.name === name)) return;
    this.database.exec(`ALTER TABLE runtime_mcp_sessions ADD COLUMN ${name} ${definition}`);
  }
}
