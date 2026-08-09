import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { SkillStore } from '@main/services/extensions/skills/SkillStore';
import { setAppDataBasePath } from '@main/utils/pathDecoder';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let appData: string;
let store: SkillStore;

beforeEach(async () => {
  appData = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-store-'));
  setAppDataBasePath(appData);
  store = new SkillStore();
});

afterEach(async () => {
  setAppDataBasePath(null);
  await fs.rm(appData, { recursive: true, force: true });
});

describe('SkillStore', () => {
  it('keeps every path free of a runtime name', () => {
    const paths = [
      store.resolveLibrarySkillDir('drafting'),
      store.resolveTeamSkillsDir('alpha'),
      store.resolveTeamSkillDir('alpha', 'drafting'),
    ];

    for (const target of paths) {
      expect(path.relative(appData, target)).not.toMatch(/claude|codex/i);
    }
  });

  it('writes and reads a skill', async () => {
    const dir = store.resolveLibrarySkillDir('drafting');

    const outcome = await store.writeSkill(dir, [
      { relativePath: 'SKILL.md', content: '# drafting\n' },
      { relativePath: 'references/style.md', content: 'terse\n' },
    ]);

    expect(outcome).toBe('installed');
    expect(await store.readSkillMarkdown(dir)).toBe('# drafting\n');
    const files = await store.readSkillFiles(dir);
    expect(files.map((file) => file.relativePath).sort()).toEqual([
      'SKILL.md',
      'references/style.md',
    ]);
  });

  it('does not clobber an existing skill unless asked', async () => {
    const dir = store.resolveTeamSkillDir('alpha', 'drafting');
    await store.writeSkill(dir, [{ relativePath: 'SKILL.md', content: 'first\n' }]);

    const second = await store.writeSkill(dir, [{ relativePath: 'SKILL.md', content: 'second\n' }]);
    expect(second).toBe('skipped');
    expect(await store.readSkillMarkdown(dir)).toBe('first\n');

    const forced = await store.writeSkill(
      dir,
      [{ relativePath: 'SKILL.md', content: 'third\n' }],
      { overwrite: true }
    );
    expect(forced).toBe('installed');
    expect(await store.readSkillMarkdown(dir)).toBe('third\n');
  });

  it('lists only directories that actually hold a skill', async () => {
    await store.writeSkill(store.resolveTeamSkillDir('alpha', 'drafting'), [
      { relativePath: 'SKILL.md', content: 'a\n' },
    ]);
    await fs.mkdir(path.join(store.resolveTeamSkillsDir('alpha'), 'not-a-skill'), {
      recursive: true,
    });

    expect(await store.listTeamSlugs('alpha')).toEqual(['drafting']);
  });

  it('treats a missing directory as empty', async () => {
    expect(await store.listTeamSlugs('never-created')).toEqual([]);
    expect(await store.readSkillMarkdown(store.resolveLibrarySkillDir('absent'))).toBeNull();
  });

  it('rejects names and paths that would escape the store', async () => {
    expect(() => store.resolveLibrarySkillDir('../escape')).toThrow();
    expect(() => store.resolveTeamSkillsDir('..')).toThrow();
    expect(() => store.resolveTeamSkillDir('alpha', '.hidden')).toThrow();

    await expect(
      store.writeSkill(store.resolveLibrarySkillDir('drafting'), [
        { relativePath: '../outside.md', content: 'nope\n' },
      ])
    ).rejects.toThrow();
  });

  it('removes a team’s skills wholesale', async () => {
    await store.writeSkill(store.resolveTeamSkillDir('alpha', 'drafting'), [
      { relativePath: 'SKILL.md', content: 'a\n' },
    ]);

    await store.removeTeam('alpha');

    expect(await store.listTeamSlugs('alpha')).toEqual([]);
  });
});
