// @vitest-environment node

import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RelayTeamDirectoryStore, TEAM_JOIN_TOKEN_PREFIX } from '@claude-teams/agent-teams-relay';
import { describe, expect, it } from 'vitest';

const TEAM_ID = '30000000-0000-4000-8000-000000000001';
const OTHER_TEAM_ID = '30000000-0000-4000-8000-000000000002';

const openStore = async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agent-teams-directory-'));
  return { dataDir, store: new RelayTeamDirectoryStore(dataDir) };
};

describe('RelayTeamDirectoryStore', () => {
  it('issues join tokens that resolve to their team and stores only a digest', async () => {
    const { dataDir, store } = await openStore();
    try {
      store.upsert({ teamId: TEAM_ID, name: '  Research crew  ', description: 'Paper triage' });
      const { token, entry, previousTokenHash } = store.rotateJoinToken(TEAM_ID);

      expect(token.startsWith(TEAM_JOIN_TOKEN_PREFIX)).toBe(true);
      expect(token).toHaveLength(47);
      expect(previousTokenHash).toBeUndefined();
      expect(entry).toMatchObject({ name: 'Research crew', listed: true, hasJoinToken: true });
      expect(store.resolveJoinToken(token)).toMatchObject({ teamId: TEAM_ID });
      expect(store.verifyJoinToken(TEAM_ID, token)).toBe(true);
      expect(store.verifyJoinToken(OTHER_TEAM_ID, token)).toBe(false);
      expect(store.verifyJoinToken(TEAM_ID, `${token.slice(0, -1)}x`)).toBe(false);
      expect(store.verifyJoinToken(TEAM_ID, 42)).toBe(false);
      expect(store.verifyJoinToken('not-a-uuid', token)).toBe(false);
      expect(store.resolveJoinToken(undefined)).toBeUndefined();
      expect(store.resolveJoinToken('plain-worker-token')).toBeUndefined();

      const database = await readFile(join(dataDir, 'relay.sqlite'));
      const wal = await readFile(join(dataDir, 'relay.sqlite-wal')).catch(() => Buffer.alloc(0));
      expect(database.includes(token)).toBe(false);
      expect(wal.includes(token)).toBe(false);
    } finally {
      store.close();
    }
  });

  it('rotation invalidates the previous token and reports its digest for session revocation', async () => {
    const { store } = await openStore();
    try {
      store.upsert({ teamId: TEAM_ID, name: 'Crew' });
      const first = store.rotateJoinToken(TEAM_ID);
      const firstHash = store.resolveJoinToken(first.token)!.tokenHash;
      const second = store.rotateJoinToken(TEAM_ID);

      expect(second.token).not.toBe(first.token);
      expect(second.previousTokenHash).toBe(firstHash);
      expect(store.verifyJoinToken(TEAM_ID, first.token)).toBe(false);
      expect(store.resolveJoinToken(first.token)).toBeUndefined();
      expect(store.verifyJoinToken(TEAM_ID, second.token)).toBe(true);
      expect(() => store.rotateJoinToken(OTHER_TEAM_ID)).toThrow('not in the directory');
    } finally {
      store.close();
    }
  });

  it('lists only listed teams with a token publicly and keeps metadata on partial updates', async () => {
    const { store } = await openStore();
    try {
      store.upsert({ teamId: TEAM_ID, name: 'Beta', description: 'Visible' });
      store.rotateJoinToken(TEAM_ID);
      store.upsert({ teamId: OTHER_TEAM_ID, name: 'Alpha', listed: false });
      store.rotateJoinToken(OTHER_TEAM_ID);
      const tokenless = store.upsert({ name: 'No token yet' });

      expect(store.list().map((entry) => entry.name)).toEqual(['Alpha', 'Beta', 'No token yet']);
      expect(store.listPublic().map((entry) => entry.teamId)).toEqual([TEAM_ID]);
      expect(tokenless.hasJoinToken).toBe(false);

      expect(store.upsert({ teamId: TEAM_ID, name: 'Beta renamed' })).toMatchObject({
        name: 'Beta renamed',
        description: 'Visible',
        listed: true,
      });
      expect(() => store.upsert({ name: '' })).toThrow('1-80 characters');
      expect(() => store.upsert({ name: 'x', listed: 'yes' })).toThrow('listed must be a boolean');
      expect(() => store.upsert({ name: 'x', description: 'd'.repeat(501) })).toThrow(
        'at most 500'
      );
    } finally {
      store.close();
    }
  });

  it('removing a team revokes its token', async () => {
    const { store } = await openStore();
    try {
      store.upsert({ teamId: TEAM_ID, name: 'Crew' });
      const { token } = store.rotateJoinToken(TEAM_ID);
      const removed = store.remove(TEAM_ID);

      expect(removed.removed).toBe(true);
      expect(removed.previousTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(store.resolveJoinToken(token)).toBeUndefined();
      expect(store.remove(TEAM_ID)).toEqual({ removed: false });
    } finally {
      store.close();
    }
  });
});
