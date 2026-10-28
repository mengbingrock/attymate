import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { GoogleIdentity } from './googleAuth';

export const opaqueToken = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export interface AccountUser {
  id: string;
  email: string;
  name: string;
}
export interface AccountSession {
  user: AccountUser;
  csrf: string;
}
export interface LoginState {
  nonce: string;
  verifier: string;
  next: string;
}
export interface AccountMembership {
  teamId: string;
  userId: string;
  role: 'owner' | 'member';
  joinedAt: number;
}
export interface AccountInvite {
  id: string;
  teamId: string;
  inviterId: string;
  email: string | null;
  expiresAt: number;
  acceptedBy: string | null;
  revokedAt: number | null;
  createdAt: number;
}
export interface AccountDevice {
  id: string;
  teamId: string;
  userId: string;
  label: string;
  nodeId: string | null;
  createdAt: number;
  revokedAt: number | null;
}
export class AccountPortalError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** Account membership is distinct from the existing device/agent membership routes. */
export class RelayAccountStore {
  private readonly db: DatabaseSync;
  constructor(
    dataDir: string,
    private readonly now = () => Date.now()
  ) {
    const path = join(dataDir, 'relay-accounts.sqlite');
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, googleSub TEXT UNIQUE NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expiresAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS login_states (hash TEXT PRIMARY KEY, browserHash TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL, next TEXT NOT NULL, expiresAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS account_memberships (teamId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('owner','member')), joinedAt INTEGER NOT NULL, PRIMARY KEY(teamId,userId));
      CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, teamId TEXT NOT NULL, inviterId TEXT NOT NULL REFERENCES users(id), email TEXT, expiresAt INTEGER NOT NULL, acceptedBy TEXT REFERENCES users(id), revokedAt INTEGER, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS account_devices (id TEXT PRIMARY KEY, hash TEXT UNIQUE, teamId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES users(id), label TEXT NOT NULL, nodeId TEXT UNIQUE, createdAt INTEGER NOT NULL, revokedAt INTEGER);
      CREATE INDEX IF NOT EXISTS account_memberships_user ON account_memberships(userId);
      CREATE INDEX IF NOT EXISTS account_devices_user ON account_devices(userId);
    `);
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private prune() {
    this.db.prepare('DELETE FROM login_states WHERE expiresAt<=?').run(this.now());
    this.db.prepare('DELETE FROM sessions WHERE expiresAt<=?').run(this.now());
  }
  createLogin(next: string) {
    this.prune();
    const state = opaqueToken(),
      browser = opaqueToken(),
      nonce = opaqueToken(),
      verifier = opaqueToken();
    const count = this.db.prepare('SELECT count(*) AS n FROM login_states').get() as { n: number };
    if (count.n >= 10000) throw new AccountPortalError(429, 'Sign-in is busy. Try again shortly.');
    this.db
      .prepare('INSERT INTO login_states VALUES (?,?,?,?,?,?)')
      .run(hash(state), hash(browser), nonce, verifier, next, this.now() + 600_000);
    return { state, browser, nonce, verifier };
  }
  consumeLogin(state: string, browser: string): LoginState | undefined {
    return this.db
      .prepare(
        'DELETE FROM login_states WHERE hash=? AND browserHash=? AND expiresAt>? RETURNING nonce,verifier,next'
      )
      .get(hash(state), hash(browser), this.now()) as LoginState | undefined;
  }
  signIn(identity: GoogleIdentity) {
    this.prune();
    const existing = this.db.prepare('SELECT id FROM users WHERE googleSub=?').get(identity.sub) as
      | { id: string }
      | undefined;
    const id = existing?.id ?? randomUUID();
    this.db
      .prepare(
        'INSERT INTO users VALUES (?,?,?,?) ON CONFLICT(googleSub) DO UPDATE SET email=excluded.email,name=excluded.name'
      )
      .run(id, identity.sub, identity.email.toLowerCase(), identity.name);
    const token = opaqueToken(),
      csrf = opaqueToken();
    this.db
      .prepare('INSERT INTO sessions VALUES (?,?,?,?)')
      .run(hash(token), id, csrf, this.now() + 7 * 86400_000);
    return { token, csrf, user: this.user(id)! };
  }
  user(id: string): AccountUser | undefined {
    return this.db.prepare('SELECT id,email,name FROM users WHERE id=?').get(id) as
      | AccountUser
      | undefined;
  }
  session(token: string | undefined): AccountSession | undefined {
    if (!token || !/^[\w-]{43}$/.test(token)) return undefined;
    const row = this.db
      .prepare('SELECT userId,csrf FROM sessions WHERE hash=? AND expiresAt>?')
      .get(hash(token), this.now()) as { userId: string; csrf: string } | undefined;
    const user = row && this.user(row.userId);
    return user && { user, csrf: row!.csrf };
  }
  signOut(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(token));
  }
  memberships(userId: string) {
    return this.db
      .prepare('SELECT * FROM account_memberships WHERE userId=? ORDER BY joinedAt DESC')
      .all(userId) as unknown as AccountMembership[];
  }
  membership(teamId: string, userId: string) {
    return this.db
      .prepare('SELECT * FROM account_memberships WHERE teamId=? AND userId=?')
      .get(teamId, userId) as AccountMembership | undefined;
  }
  requireMember(teamId: string, userId: string, owner = false) {
    const m = this.membership(teamId, userId);
    if (!m || (owner && m.role !== 'owner')) throw new AccountPortalError(404, 'Team not found.');
    return m;
  }
  addOwner(teamId: string, userId: string) {
    this.db
      .prepare('INSERT INTO account_memberships VALUES (?,?,?,?)')
      .run(teamId, userId, 'owner', this.now());
  }
  members(teamId: string) {
    return this.db
      .prepare(
        'SELECT u.id,u.name,u.email,m.role,m.joinedAt FROM account_memberships m JOIN users u ON u.id=m.userId WHERE teamId=? ORDER BY joinedAt'
      )
      .all(teamId) as unknown as (AccountUser & { role: 'owner' | 'member'; joinedAt: number })[];
  }
  createInvite(teamId: string, userId: string, email?: string) {
    this.requireMember(teamId, userId, true);
    const pending = this.db
      .prepare(
        'SELECT count(*) AS n FROM invites WHERE teamId=? AND acceptedBy IS NULL AND revokedAt IS NULL AND expiresAt>?'
      )
      .get(teamId, this.now()) as { n: number };
    if (pending.n >= 100)
      throw new AccountPortalError(429, 'Revoke an unused invitation before creating another.');
    const id = randomUUID(),
      token = 'ati_' + opaqueToken();
    this.db
      .prepare('INSERT INTO invites VALUES (?,?,?,?,?,?,NULL,NULL,?)')
      .run(
        id,
        hash(token),
        teamId,
        userId,
        email?.toLowerCase() ?? null,
        this.now() + 7 * 86400_000,
        this.now()
      );
    return { token, invite: this.invite(token)! };
  }
  invite(token: string): AccountInvite | undefined {
    if (!/^ati_[\w-]{43}$/.test(token)) return undefined;
    return this.db
      .prepare(
        'SELECT id,teamId,inviterId,email,expiresAt,acceptedBy,revokedAt,createdAt FROM invites WHERE hash=?'
      )
      .get(hash(token)) as AccountInvite | undefined;
  }
  invites(teamId: string) {
    return this.db
      .prepare(
        'SELECT id,teamId,inviterId,email,expiresAt,acceptedBy,revokedAt,createdAt FROM invites WHERE teamId=? ORDER BY createdAt DESC LIMIT 100'
      )
      .all(teamId) as unknown as AccountInvite[];
  }
  acceptInvite(token: string, user: AccountUser) {
    return this.transaction(() => {
      const invite = this.invite(token);
      if (
        !invite ||
        invite.revokedAt ||
        (invite.expiresAt <= this.now() && invite.acceptedBy !== user.id)
      )
        throw new AccountPortalError(
          410,
          'This invitation expired or was revoked. Ask the owner for a new link.'
        );
      if (invite.acceptedBy && invite.acceptedBy !== user.id)
        throw new AccountPortalError(
          410,
          'This invitation has already been used. Ask the owner for your own link.'
        );
      if (invite.email && invite.email !== user.email.toLowerCase())
        throw new AccountPortalError(
          403,
          'This invitation is for a different Google account. Switch accounts to join.'
        );
      this.db
        .prepare("INSERT OR IGNORE INTO account_memberships VALUES (?,?,'member',?)")
        .run(invite.teamId, user.id, this.now());
      this.db
        .prepare('UPDATE invites SET acceptedBy=? WHERE id=? AND acceptedBy IS NULL')
        .run(user.id, invite.id);
      return invite.teamId;
    });
  }
  revokeInvite(teamId: string, userId: string, id: string) {
    this.requireMember(teamId, userId, true);
    this.db
      .prepare('UPDATE invites SET revokedAt=? WHERE id=? AND teamId=? AND acceptedBy IS NULL')
      .run(this.now(), id, teamId);
  }
  createDevice(teamId: string, userId: string, label: string) {
    this.requireMember(teamId, userId);
    const n = this.devices(userId).filter((d) => !d.revokedAt).length;
    if (n >= 20) throw new AccountPortalError(429, 'Device limit reached.');
    const id = randomUUID(),
      token = 'atd_' + opaqueToken();
    this.db
      .prepare('INSERT INTO account_devices VALUES (?,?,?,?,?,NULL,?,NULL)')
      .run(id, hash(token), teamId, userId, label, this.now());
    return { token, device: this.device(id)! };
  }
  resolveDevice(token: string | undefined) {
    if (!token || !/^atd_[\w-]{43}$/.test(token)) return undefined;
    const row = this.db
      .prepare(
        'SELECT id,teamId,userId,nodeId FROM account_devices WHERE hash=? AND revokedAt IS NULL'
      )
      .get(hash(token)) as Pick<AccountDevice, 'id' | 'teamId' | 'userId' | 'nodeId'> | undefined;
    return row && this.membership(row.teamId, row.userId)
      ? { ...row, tokenHash: hash(token) }
      : undefined;
  }
  bindDevice(id: string, nodeId: string) {
    return (
      this.db
        .prepare(
          'UPDATE account_devices SET nodeId=? WHERE id=? AND revokedAt IS NULL AND (nodeId IS NULL OR nodeId=?)'
        )
        .run(nodeId, id, nodeId).changes === 1
    );
  }
  claimDevice(teamId: string, userId: string, nodeId: string, label: string) {
    this.requireMember(teamId, userId);
    const old = this.db.prepare('SELECT * FROM account_devices WHERE nodeId=?').get(nodeId) as
      | AccountDevice
      | undefined;
    if (old && (old.userId !== userId || old.teamId !== teamId || old.revokedAt))
      throw new AccountPortalError(
        409,
        'This device is already linked to another account or team.'
      );
    if (old) return old;
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO account_devices VALUES (?,NULL,?,?,?,?,?,NULL)')
      .run(id, teamId, userId, label, nodeId, this.now());
    return this.device(id)!;
  }
  device(id: string) {
    return this.db
      .prepare(
        'SELECT id,teamId,userId,label,nodeId,createdAt,revokedAt FROM account_devices WHERE id=?'
      )
      .get(id) as AccountDevice | undefined;
  }
  devices(userId: string) {
    return this.db
      .prepare(
        'SELECT id,teamId,userId,label,nodeId,createdAt,revokedAt FROM account_devices WHERE userId=? ORDER BY createdAt DESC'
      )
      .all(userId) as unknown as AccountDevice[];
  }
  revokeDevice(userId: string, id: string, expectedNodeId: string | null) {
    return this.transaction(() => {
      const device = this.device(id);
      if (!device || device.userId !== userId)
        throw new AccountPortalError(404, 'Device not found.');
      if (device.nodeId !== expectedNodeId)
        throw new AccountPortalError(
          409,
          'This device changed. Refresh and review it before removing it.'
        );
      this.db
        .prepare('UPDATE account_devices SET revokedAt=COALESCE(revokedAt,?) WHERE id=?')
        .run(this.now(), id);
      return device;
    });
  }
  close() {
    this.db.close();
  }
}
