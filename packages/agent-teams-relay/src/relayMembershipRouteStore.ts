import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  membershipIdSchema,
  nodeIdSchema,
  teamIdSchema,
  teamMembershipRoleSchema,
  teamMembershipStatusSchema,
  workspaceIdSchema,
  type MembershipId,
  type NodeId,
  type TeamId,
  type TeamMembershipRole,
  type TeamMembershipStatus,
  type WorkspaceId,
} from '@claude-teams/agent-teams-protocol';

export interface RelayMembershipRoute {
  readonly membershipId: MembershipId;
  readonly teamId: TeamId;
  readonly nodeId: NodeId;
  readonly workspaceId: WorkspaceId;
  readonly label: string;
  readonly role: TeamMembershipRole;
  readonly status: TeamMembershipStatus;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly leftAt?: string;
}

interface RelayMembershipRouteRow {
  membership_id: string;
  team_id: string;
  node_id: string;
  workspace_id: string;
  label: string;
  role: string;
  status: string;
  revision: number;
  created_at: string;
  updated_at: string;
  left_at: string | null;
}

const mapRow = (row: RelayMembershipRouteRow): RelayMembershipRoute => ({
  membershipId: membershipIdSchema.parse(row.membership_id),
  teamId: teamIdSchema.parse(row.team_id),
  nodeId: nodeIdSchema.parse(row.node_id),
  workspaceId: workspaceIdSchema.parse(row.workspace_id),
  label: row.label,
  role: teamMembershipRoleSchema.parse(row.role),
  status: teamMembershipStatusSchema.parse(row.status),
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.left_at === null ? {} : { leftAt: row.left_at }),
});

export class RelayMembershipRouteConflictError extends Error {
  readonly code = 'RELAY_MEMBERSHIP_ROUTE_CONFLICT';

  constructor(readonly membershipId: MembershipId) {
    super(`Membership ${membershipId} is already bound to a different team, node, or workspace`);
    this.name = 'RelayMembershipRouteConflictError';
  }
}

export class RelayTeamLeadConflictError extends Error {
  readonly code = 'RELAY_TEAM_LEAD_CONFLICT';

  constructor(readonly teamId: TeamId) {
    super(`Team ${teamId} already has an active lead`);
    this.name = 'RelayTeamLeadConflictError';
  }
}

export class RelayMembershipRevisionConflictError extends Error {
  readonly code = 'RELAY_MEMBERSHIP_REVISION_CONFLICT';

  constructor(
    readonly membershipId: MembershipId,
    readonly expectedRevision: number,
    readonly actualRevision: number
  ) {
    super(
      `Membership ${membershipId} revision ${actualRevision} does not match expected revision ${expectedRevision}`
    );
    this.name = 'RelayMembershipRevisionConflictError';
  }
}

export class RelayMembershipRouteStore {
  private readonly database: DatabaseSync;

  constructor(dataDir: string) {
    this.database = new DatabaseSync(join(dataDir, 'relay.sqlite'));
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS relay_membership_routes (
        membership_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT 'Remote member',
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'active',
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        left_at TEXT
      );
      CREATE INDEX IF NOT EXISTS relay_membership_routes_team_node
        ON relay_membership_routes(team_id, node_id);
    `);
    this.ensureColumn('label', "TEXT NOT NULL DEFAULT 'Remote member'");
    this.ensureColumn('role', "TEXT NOT NULL DEFAULT 'member'");
    this.ensureColumn('status', "TEXT NOT NULL DEFAULT 'active'");
    this.ensureColumn('revision', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('left_at', 'TEXT');
    this.migrateTeamLeads();
    this.database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS relay_membership_routes_active_lead
        ON relay_membership_routes(team_id)
        WHERE role = 'lead' AND status = 'active';
      CREATE UNIQUE INDEX IF NOT EXISTS relay_membership_routes_active_team_node
        ON relay_membership_routes(team_id, node_id)
        WHERE status = 'active';
    `);
  }

  register(input: {
    readonly membershipId: string;
    readonly teamId: string;
    readonly nodeId: string;
    readonly workspaceId: string;
    readonly label?: string;
    readonly role?: TeamMembershipRole;
  }): RelayMembershipRoute {
    const membershipId = membershipIdSchema.parse(input.membershipId);
    const teamId = teamIdSchema.parse(input.teamId);
    const nodeId = nodeIdSchema.parse(input.nodeId);
    const workspaceId = workspaceIdSchema.parse(input.workspaceId);
    const label = this.normalizeLabel(input.label);
    const existing = this.get(membershipId);
    if (existing !== undefined) {
      if (
        existing.teamId !== teamId ||
        existing.nodeId !== nodeId ||
        existing.workspaceId !== workspaceId ||
        existing.status !== 'active' ||
        (input.role !== undefined && existing.role !== input.role)
      ) {
        throw new RelayMembershipRouteConflictError(membershipId);
      }
      return existing;
    }
    const role = input.role ?? (this.listActiveForTeam(teamId).length === 0 ? 'lead' : 'member');
    if (this.listActiveForTeam(teamId).some((route) => route.nodeId === nodeId)) {
      throw new TypeError(`Worker node ${nodeId} is already an active member of team ${teamId}`);
    }
    if (role === 'lead' && this.activeLead(teamId) !== undefined) {
      throw new RelayTeamLeadConflictError(teamId);
    }
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO relay_membership_routes
          (membership_id, team_id, node_id, workspace_id, label, role, status, revision,
           created_at, updated_at, left_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, NULL)`
      )
      .run(membershipId, teamId, nodeId, workspaceId, label, role, now, now);
    const stored = this.get(membershipId);
    if (stored === undefined) throw new Error('Relay membership route insert did not produce a row');
    return stored;
  }

  leave(input: {
    readonly teamId: string;
    readonly membershipId: string;
    readonly expectedRevision?: number;
    readonly successorMembershipId?: string;
  }): RelayMembershipRoute {
    const teamId = teamIdSchema.parse(input.teamId);
    const membershipId = membershipIdSchema.parse(input.membershipId);
    const existing = this.get(membershipId);
    if (existing === undefined || existing.teamId !== teamId) {
      throw new TypeError(`Membership ${membershipId} does not belong to team ${teamId}`);
    }
    if (existing.status === 'left') return existing;
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== existing.revision
    ) {
      throw new RelayMembershipRevisionConflictError(
        membershipId,
        input.expectedRevision,
        existing.revision
      );
    }
    const remaining = this.listActiveForTeam(teamId).filter(
      (route) => route.membershipId !== membershipId
    );
    let successor: RelayMembershipRoute | undefined;
    if (existing.role === 'lead' && remaining.length > 0) {
      if (input.successorMembershipId === undefined) {
        throw new TypeError('Removing an active lead requires a successorMembershipId');
      }
      successor = this.get(input.successorMembershipId);
      if (
        successor === undefined ||
        successor.teamId !== teamId ||
        successor.status !== 'active' ||
        successor.membershipId === membershipId
      ) {
        throw new TypeError('Lead successor must be another active membership in the same team');
      }
    } else if (input.successorMembershipId !== undefined) {
      throw new TypeError('successorMembershipId is only valid when removing the active lead');
    }

    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database
        .prepare(
          `UPDATE relay_membership_routes
           SET status = 'left', revision = revision + 1, updated_at = ?, left_at = ?
           WHERE membership_id = ? AND status = 'active'`
        )
        .run(now, now, membershipId);
      if (successor !== undefined) {
        this.database
          .prepare(
            `UPDATE relay_membership_routes
             SET role = 'lead', revision = revision + 1, updated_at = ?
             WHERE membership_id = ? AND status = 'active'`
          )
          .run(now, successor.membershipId);
      }
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
    return this.get(membershipId)!;
  }

  get(inputMembershipId: string): RelayMembershipRoute | undefined {
    const membershipId = membershipIdSchema.parse(inputMembershipId);
    const row = this.database
      .prepare('SELECT * FROM relay_membership_routes WHERE membership_id = ?')
      .get(membershipId) as RelayMembershipRouteRow | undefined;
    return row === undefined ? undefined : mapRow(row);
  }

  listAll(): readonly RelayMembershipRoute[] {
    const rows = this.database
      .prepare('SELECT * FROM relay_membership_routes ORDER BY created_at ASC, membership_id ASC')
      .all() as unknown as RelayMembershipRouteRow[];
    return rows.map(mapRow);
  }

  listActiveForTeam(inputTeamId: string): readonly RelayMembershipRoute[] {
    const teamId = teamIdSchema.parse(inputTeamId);
    const rows = this.database
      .prepare(
        `SELECT * FROM relay_membership_routes
         WHERE team_id = ? AND status = 'active'
         ORDER BY CASE role WHEN 'lead' THEN 0 ELSE 1 END, created_at ASC, membership_id ASC`
      )
      .all(teamId) as unknown as RelayMembershipRouteRow[];
    return rows.map(mapRow);
  }

  activeLead(inputTeamId: string): RelayMembershipRoute | undefined {
    const teamId = teamIdSchema.parse(inputTeamId);
    const row = this.database
      .prepare(
        `SELECT * FROM relay_membership_routes
         WHERE team_id = ? AND role = 'lead' AND status = 'active' LIMIT 1`
      )
      .get(teamId) as RelayMembershipRouteRow | undefined;
    return row === undefined ? undefined : mapRow(row);
  }

  close(): void {
    this.database.close();
  }

  private normalizeLabel(value: string | undefined): string {
    if (value === undefined) return 'Remote member';
    const label = value.trim();
    if (label.length === 0 || label.length > 128) {
      throw new TypeError('Membership label must contain 1-128 characters');
    }
    return label;
  }

  private ensureColumn(name: string, definition: string): void {
    const columns = this.database.prepare('PRAGMA table_info(relay_membership_routes)').all() as Array<{
      name: string;
    }>;
    if (columns.some((column) => column.name === name)) return;
    this.database.exec(`ALTER TABLE relay_membership_routes ADD COLUMN ${name} ${definition}`);
  }

  private migrateTeamLeads(): void {
    const teams = this.database
      .prepare("SELECT DISTINCT team_id FROM relay_membership_routes WHERE status = 'active'")
      .all() as Array<{ team_id: string }>;
    for (const { team_id: teamId } of teams) {
      const lead = this.database
        .prepare(
          "SELECT membership_id FROM relay_membership_routes WHERE team_id = ? AND role = 'lead' AND status = 'active' LIMIT 1"
        )
        .get(teamId);
      if (lead !== undefined) continue;
      const first = this.database
        .prepare(
          "SELECT membership_id FROM relay_membership_routes WHERE team_id = ? AND status = 'active' ORDER BY created_at ASC, membership_id ASC LIMIT 1"
        )
        .get(teamId) as { membership_id: string } | undefined;
      if (first !== undefined) {
        this.database
          .prepare("UPDATE relay_membership_routes SET role = 'lead' WHERE membership_id = ?")
          .run(first.membership_id);
      }
    }
  }
}
