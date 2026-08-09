import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { SkillRootsResolver } from '@main/services/extensions/skills/SkillRootsResolver';
import { setAppDataBasePath } from '@main/utils/pathDecoder';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let appData: string;

const CLI_ROOT_KINDS = ['claude', 'cursor', 'agents', 'codex'];

beforeEach(async () => {
  appData = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-roots-'));
  setAppDataBasePath(appData);
});

afterEach(async () => {
  setAppDataBasePath(null);
  await fs.rm(appData, { recursive: true, force: true });
});

describe('SkillRootsResolver', () => {
  it('returns the app library plus the user roots when nothing else is scoped', () => {
    const resolver = new SkillRootsResolver();

    const roots = resolver.resolve();

    expect(roots).toHaveLength(5);
    expect(roots[0]).toEqual({
      scope: 'library',
      rootKind: 'library',
      teamName: null,
      projectRoot: null,
      rootPath: path.join(appData, 'skills', 'library'),
    });
    expect(roots.slice(1).every((root) => root.scope === 'user')).toBe(true);
    expect(roots.slice(1).map((root) => root.rootKind)).toEqual(CLI_ROOT_KINDS);
    expect(roots.every((root) => root.teamName === null)).toBe(true);
  });

  it('returns project and user roots when project path is provided', () => {
    const resolver = new SkillRootsResolver();

    const roots = resolver.resolve('/tmp/demo-project');

    expect(roots).toHaveLength(9);
    expect(roots.filter((root) => root.scope === 'library')).toHaveLength(1);
    expect(roots.filter((root) => root.scope === 'project')).toHaveLength(4);
    expect(roots.filter((root) => root.scope === 'user')).toHaveLength(4);
  });

  it('adds the team root, ahead of the CLI roots, when a team is named', () => {
    const resolver = new SkillRootsResolver();

    const roots = resolver.resolve({ teamName: 'signal-ops' });

    expect(roots).toHaveLength(6);
    expect(roots[1]).toEqual({
      scope: 'team',
      rootKind: 'library',
      teamName: 'signal-ops',
      projectRoot: null,
      rootPath: path.join(appData, 'skills', 'teams', 'signal-ops'),
    });
    // No CLI root ever carries a team.
    expect(roots.filter((root) => root.teamName !== null)).toHaveLength(1);
  });

  it('rejects a team name that could escape the canonical store', () => {
    const resolver = new SkillRootsResolver();

    expect(() => resolver.resolve({ teamName: '../library' })).toThrow('Invalid team name');
  });

  it('offers only the runtime-branded user roots as projection targets', () => {
    const resolver = new SkillRootsResolver();

    const targets = resolver.resolveUserProjectionRoots();

    expect(targets.map((root) => root.rootKind)).toEqual(CLI_ROOT_KINDS);
    expect(targets.every((root) => root.scope === 'user')).toBe(true);
  });
});
