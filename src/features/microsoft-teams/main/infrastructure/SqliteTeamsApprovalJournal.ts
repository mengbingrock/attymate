import { chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import type { TeamsApprovalJournal, TeamsApprovalRecord } from '../../contracts';

export class SqliteTeamsApprovalJournal implements TeamsApprovalJournal {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS teams_approvals (
        id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, value TEXT NOT NULL, state TEXT NOT NULL
      );
      UPDATE teams_approvals SET state='unknown' WHERE state IN ('sending','resolving');`);
  }

  add(value: TeamsApprovalRecord): TeamsApprovalRecord {
    this.db
      .prepare('INSERT OR IGNORE INTO teams_approvals VALUES (?,?,?,?)')
      .run(value.id, value.key, JSON.stringify(value), value.state);
    const row = this.db
      .prepare('SELECT value,state FROM teams_approvals WHERE fingerprint=?')
      .get(value.key)!;
    return this.decode(row);
  }

  get(id: string): TeamsApprovalRecord | undefined {
    const row = this.db.prepare('SELECT value,state FROM teams_approvals WHERE id=?').get(id);
    return row ? this.decode(row) : undefined;
  }

  pending(): TeamsApprovalRecord[] {
    return this.db
      .prepare("SELECT value,state FROM teams_approvals WHERE state='pending' ORDER BY rowid")
      .all()
      .map((row) => this.decode(row));
  }

  unconfirmed(): TeamsApprovalRecord[] {
    // A newer card for the same RPC supersedes earlier cards, including expired ones.
    const latest = new Map<string, TeamsApprovalRecord>();
    for (const row of this.db
      .prepare('SELECT value,state FROM teams_approvals ORDER BY rowid DESC')
      .all()) {
      const value = this.decode(row);
      const rpc = JSON.stringify([
        value.scope,
        value.appServerGeneration,
        value.threadId,
        value.turnId,
        value.request.id,
        value.request.method,
      ]);
      if (!latest.has(rpc)) latest.set(rpc, value);
    }
    return [...latest.values()].filter(
      (value) => value.state === 'unknown' || value.state === 'expired' || value.state === 'shown'
    );
  }

  tracked(): TeamsApprovalRecord[] {
    return this.db
      .prepare(
        `SELECT value,state FROM teams_approvals
      WHERE json_extract(value,'$.dispatch.controlId') IS NOT NULL
      AND ((state IN ('resolving','unknown') AND coalesce(json_extract(value,'$.dispatch.coverageLost'),0)=0)
        OR (json_extract(value,'$.dispatch.receiptPending')=1
          AND state IN ('resolved','expired','unknown')
          AND coalesce(json_extract(value,'$.dispatch.notifiedState'),'')<>state))`
      )
      .all()
      .map((row) => this.decode(row));
  }

  hasTaskGrant(key: string): boolean {
    return (
      this.db
        .prepare(
          `SELECT 1 FROM teams_approvals WHERE state='resolved'
      AND json_extract(value,'$.dispatch.decision')='accept'
      AND json_extract(value,'$.dispatch.source')='owner'
      AND json_extract(value,'$.dispatch.grantKey')=? LIMIT 1`
        )
        .get(key) !== undefined
    );
  }

  transition(
    id: string,
    from: TeamsApprovalRecord['state'],
    to: TeamsApprovalRecord['state'],
    dispatch?: TeamsApprovalRecord['dispatch']
  ): boolean {
    if (dispatch !== undefined) {
      const current = this.get(id);
      if (!current || current.state !== from) return false;
      return (
        this.db
          .prepare('UPDATE teams_approvals SET state=?,value=? WHERE id=? AND state=?')
          .run(to, JSON.stringify({ ...current, dispatch }), id, from).changes === 1
      );
    }
    return (
      this.db.prepare('UPDATE teams_approvals SET state=? WHERE id=? AND state=?').run(to, id, from)
        .changes === 1
    );
  }

  close(): void {
    this.db.close();
  }

  private decode(row: Record<string, unknown>): TeamsApprovalRecord {
    return {
      ...(JSON.parse(String(row.value)) as TeamsApprovalRecord),
      state: String(row.state) as TeamsApprovalRecord['state'],
    };
  }
}
