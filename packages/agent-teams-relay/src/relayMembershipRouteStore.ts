import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  membershipIdSchema,
  nodeIdSchema,
  teamIdSchema,
  workspaceIdSchema,
  type MembershipId,
  type NodeId,
  type TeamId,
  type WorkspaceId,
} from '@claude-teams/agent-teams-protocol';

export interface RelayMembershipRoute {
  readonly membershipId: MembershipId;
  readonly teamId: TeamId;
  readonly nodeId: NodeId;
  readonly workspaceId: WorkspaceId;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RelayMembershipRouteRow {
  membership_id: string;
  team_id: string;
  node_id: string;
  workspace_id: string;
  created_at: string;
  updated_at: string;
}

const mapRow = (row: RelayMembershipRouteRow): RelayMembershipRoute => ({
  membershipId: membershipIdSchema.parse(row.membership_id),
  teamId: teamIdSchema.parse(row.team_id),
  nodeId: nodeIdSchema.parse(row.node_id),
  workspaceId: workspaceIdSchema.parse(row.workspace_id),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class RelayMembershipRouteConflictError extends Error {
  readonly code = 'RELAY_MEMBERSHIP_ROUTE_CONFLICT';

  constructor(readonly membershipId: MembershipId) {
    super(`Membership ${membershipId} is already bound to a different team, node, or workspace`);
    this.name = 'RelayMembershipRouteConflictError';
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
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS relay_membership_routes_team_node
        ON relay_membership_routes(team_id, node_id);
    `);
  }

  register(input: {
    readonly membershipId: string;
    readonly teamId: string;
    readonly nodeId: string;
    readonly workspaceId: string;
  }): RelayMembershipRoute {
    const membershipId = membershipIdSchema.parse(input.membershipId);
    const teamId = teamIdSchema.parse(input.teamId);
    const nodeId = nodeIdSchema.parse(input.nodeId);
    const workspaceId = workspaceIdSchema.parse(input.workspaceId);
    const existing = this.get(membershipId);
    if (existing !== undefined) {
      if (
        existing.teamId !== teamId ||
        existing.nodeId !== nodeId ||
        existing.workspaceId !== workspaceId
      ) {
        throw new RelayMembershipRouteConflictError(membershipId);
      }
      return existing;
    }
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO relay_membership_routes
          (membership_id, team_id, node_id, workspace_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(membershipId, teamId, nodeId, workspaceId, now, now);
    const stored = this.get(membershipId);
    if (stored === undefined) throw new Error('Relay membership route insert did not produce a row');
    return stored;
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

  close(): void {
    this.database.close();
  }
}
