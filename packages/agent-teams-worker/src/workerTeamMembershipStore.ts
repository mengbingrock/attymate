import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  teamIdSchema,
  teamMembershipSnapshotPayloadSchema,
  type TeamMembershipSnapshotPayload,
} from '@claude-teams/agent-teams-protocol';

import type { WorkerInboxCommand } from './workerInboxStore';

interface TeamMembershipSnapshotRow {
  team_id: string;
  payload_json: string;
  generated_at: string;
  received_at: string;
}

export interface WorkerTeamMembershipSnapshot extends TeamMembershipSnapshotPayload {
  readonly receivedAt: string;
}

const mapRow = (row: TeamMembershipSnapshotRow): WorkerTeamMembershipSnapshot => ({
  ...teamMembershipSnapshotPayloadSchema.parse(JSON.parse(row.payload_json)),
  receivedAt: row.received_at,
});

export class WorkerTeamMembershipStore {
  private readonly database: DatabaseSync;

  constructor(dataDir: string) {
    this.database = new DatabaseSync(join(dataDir, 'worker.sqlite'));
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS team_membership_snapshots (
        team_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
    `);
  }

  accept(command: WorkerInboxCommand): WorkerTeamMembershipSnapshot | undefined {
    if (command.envelope.type !== 'team.membership.snapshot') return undefined;
    const payload = teamMembershipSnapshotPayloadSchema.parse(command.envelope.payload);
    if (command.envelope.teamId !== payload.teamId) {
      throw new TypeError('Team membership snapshot identity does not match its command envelope');
    }
    const current = this.get(payload.teamId);
    if (current !== undefined && current.generatedAt > payload.generatedAt) return current;
    this.database
      .prepare(
        `INSERT INTO team_membership_snapshots
          (team_id, payload_json, generated_at, received_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(team_id) DO UPDATE SET
           payload_json = excluded.payload_json,
           generated_at = excluded.generated_at,
           received_at = excluded.received_at
         WHERE excluded.generated_at >= team_membership_snapshots.generated_at`
      )
      .run(payload.teamId, JSON.stringify(payload), payload.generatedAt, command.receivedAt);
    return this.get(payload.teamId);
  }

  get(inputTeamId: string): WorkerTeamMembershipSnapshot | undefined {
    const teamId = teamIdSchema.parse(inputTeamId);
    const row = this.database
      .prepare('SELECT * FROM team_membership_snapshots WHERE team_id = ?')
      .get(teamId) as TeamMembershipSnapshotRow | undefined;
    return row === undefined ? undefined : mapRow(row);
  }

  list(): readonly WorkerTeamMembershipSnapshot[] {
    const rows = this.database
      .prepare('SELECT * FROM team_membership_snapshots ORDER BY generated_at ASC, team_id ASC')
      .all() as unknown as TeamMembershipSnapshotRow[];
    return rows.map(mapRow);
  }

  close(): void {
    this.database.close();
  }
}
