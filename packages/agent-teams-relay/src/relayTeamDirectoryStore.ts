import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { teamIdSchema, type TeamId } from '@claude-teams/agent-teams-protocol';

/**
 * Public-facing team directory: display metadata plus a per-team join token.
 *
 * Only a SHA-256 digest of each join token is stored. Tokens are 256-bit random values, so a plain
 * digest is sufficient (no slow KDF needed) and lets the Relay resolve a presented token to its team
 * with one indexed lookup during the WebSocket upgrade.
 */
export interface RelayTeamDirectoryEntry {
  readonly teamId: TeamId;
  readonly name: string;
  readonly description: string;
  /** Unlisted teams are joinable by token but hidden from the public directory. */
  readonly listed: boolean;
  readonly hasJoinToken: boolean;
  readonly joinTokenRotatedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RelayTeamDirectoryRow {
  team_id: string;
  name: string;
  description: string;
  listed: number;
  join_token_hash: string | null;
  join_token_rotated_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Join tokens carry a recognizable prefix so they are easy to spot in configs and secret scanners. */
export const TEAM_JOIN_TOKEN_PREFIX = 'atj_';
const TEAM_JOIN_TOKEN_PATTERN = /^atj_[A-Za-z0-9_-]{43}$/;

const hashJoinToken = (token: string): string =>
  createHash('sha256').update(`agent-teams-team-join:${token}`).digest('hex');

const mapRow = (row: RelayTeamDirectoryRow): RelayTeamDirectoryEntry => ({
  teamId: teamIdSchema.parse(row.team_id),
  name: row.name,
  description: row.description,
  listed: row.listed === 1,
  hasJoinToken: row.join_token_hash !== null,
  ...(row.join_token_rotated_at === null ? {} : { joinTokenRotatedAt: row.join_token_rotated_at }),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const normalizeName = (value: unknown): string => {
  if (typeof value !== 'string') throw new TypeError('Team name must be a string');
  const name = value.trim();
  if (name.length === 0 || name.length > 80) {
    throw new TypeError('Team name must contain 1-80 characters');
  }
  return name;
};

const normalizeDescription = (value: unknown): string => {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new TypeError('Team description must be a string');
  const description = value.trim();
  if (description.length > 500)
    throw new TypeError('Team description must be at most 500 characters');
  return description;
};

export class RelayTeamDirectoryStore {
  private readonly database: DatabaseSync;

  constructor(dataDir: string) {
    this.database = new DatabaseSync(join(dataDir, 'relay.sqlite'));
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS relay_team_directory (
        team_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        listed INTEGER NOT NULL DEFAULT 1,
        join_token_hash TEXT,
        join_token_rotated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS relay_team_directory_join_token
        ON relay_team_directory(join_token_hash)
        WHERE join_token_hash IS NOT NULL;
    `);
  }

  /** Creates or updates a team's directory entry. A new entry gets a team ID when none is given. */
  upsert(input: {
    readonly teamId?: string;
    readonly name: unknown;
    readonly description?: unknown;
    readonly listed?: unknown;
  }): RelayTeamDirectoryEntry {
    const teamId = teamIdSchema.parse(input.teamId ?? randomUUID());
    const name = normalizeName(input.name);
    const existing = this.get(teamId);
    const description =
      input.description === undefined
        ? (existing?.description ?? '')
        : normalizeDescription(input.description);
    if (input.listed !== undefined && typeof input.listed !== 'boolean') {
      throw new TypeError('listed must be a boolean');
    }
    const listed = input.listed ?? existing?.listed ?? true;
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO relay_team_directory (team_id, name, description, listed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(team_id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           listed = excluded.listed,
           updated_at = excluded.updated_at`
      )
      .run(teamId, name, description, listed ? 1 : 0, now, now);
    return this.get(teamId)!;
  }

  get(inputTeamId: string): RelayTeamDirectoryEntry | undefined {
    const teamId = teamIdSchema.parse(inputTeamId);
    const row = this.database
      .prepare('SELECT * FROM relay_team_directory WHERE team_id = ?')
      .get(teamId) as RelayTeamDirectoryRow | undefined;
    return row === undefined ? undefined : mapRow(row);
  }

  list(): readonly RelayTeamDirectoryEntry[] {
    const rows = this.database
      .prepare('SELECT * FROM relay_team_directory ORDER BY lower(name), team_id')
      .all() as unknown as RelayTeamDirectoryRow[];
    return rows.map(mapRow);
  }

  /** Teams shown in the public directory: listed and joinable. */
  listPublic(): readonly RelayTeamDirectoryEntry[] {
    return this.list().filter((entry) => entry.listed && entry.hasJoinToken);
  }

  /**
   * Issues a new join token, invalidating the previous one. The plaintext token is returned once and
   * never stored. Returns the digest of the replaced token so callers can disconnect its sessions.
   */
  rotateJoinToken(inputTeamId: string): {
    readonly token: string;
    readonly entry: RelayTeamDirectoryEntry;
    readonly previousTokenHash?: string;
  } {
    const teamId = teamIdSchema.parse(inputTeamId);
    const previous = this.database
      .prepare('SELECT join_token_hash FROM relay_team_directory WHERE team_id = ?')
      .get(teamId) as { join_token_hash: string | null } | undefined;
    if (previous === undefined) throw new TypeError(`Team ${teamId} is not in the directory`);
    const token = `${TEAM_JOIN_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE relay_team_directory
         SET join_token_hash = ?, join_token_rotated_at = ?, updated_at = ?
         WHERE team_id = ?`
      )
      .run(hashJoinToken(token), now, now, teamId);
    return {
      token,
      entry: this.get(teamId)!,
      ...(previous.join_token_hash === null ? {} : { previousTokenHash: previous.join_token_hash }),
    };
  }

  /** Removes a team from the directory, which also revokes its join token. */
  remove(inputTeamId: string): { readonly removed: boolean; readonly previousTokenHash?: string } {
    const teamId = teamIdSchema.parse(inputTeamId);
    const previous = this.database
      .prepare('SELECT join_token_hash FROM relay_team_directory WHERE team_id = ?')
      .get(teamId) as { join_token_hash: string | null } | undefined;
    if (previous === undefined) return { removed: false };
    this.database.prepare('DELETE FROM relay_team_directory WHERE team_id = ?').run(teamId);
    return {
      removed: true,
      ...(previous.join_token_hash === null ? {} : { previousTokenHash: previous.join_token_hash }),
    };
  }

  /** Resolves a presented join token to its team, or undefined. Used by the Worker upgrade. */
  resolveJoinToken(
    token: string | undefined
  ): { readonly teamId: TeamId; readonly tokenHash: string } | undefined {
    if (token === undefined || !TEAM_JOIN_TOKEN_PATTERN.test(token)) return undefined;
    const tokenHash = hashJoinToken(token);
    const row = this.database
      .prepare('SELECT team_id FROM relay_team_directory WHERE join_token_hash = ?')
      .get(tokenHash) as { team_id: string } | undefined;
    return row === undefined ? undefined : { teamId: teamIdSchema.parse(row.team_id), tokenHash };
  }

  /** Checks a token against one team's current join token in constant time. */
  verifyJoinToken(inputTeamId: string, token: unknown): boolean {
    if (typeof token !== 'string' || !TEAM_JOIN_TOKEN_PATTERN.test(token)) return false;
    const parsedTeamId = teamIdSchema.safeParse(inputTeamId);
    if (!parsedTeamId.success) return false;
    const row = this.database
      .prepare('SELECT join_token_hash FROM relay_team_directory WHERE team_id = ?')
      .get(parsedTeamId.data) as { join_token_hash: string | null } | undefined;
    if (row?.join_token_hash == null) return false;
    const supplied = Buffer.from(hashJoinToken(token), 'hex');
    const expected = Buffer.from(row.join_token_hash, 'hex');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  close(): void {
    this.database.close();
  }
}
