import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { SkillsMutationInstaller } from '@features/team-import/main/infrastructure/SkillsMutationInstaller';
import { SkillStore } from '@main/services/extensions/skills/SkillStore';
import { setAppDataBasePath } from '@main/utils/pathDecoder';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TeamImportBundleSkill } from '@features/team-import/contracts';

function skill(slug: string): TeamImportBundleSkill {
  return {
    slug,
    description: 'demo',
    files: [
      { relativePath: 'SKILL.md', content: `---\nname: ${slug}\n---\n\nBody\n` },
      { relativePath: 'references/notes.md', content: 'notes' },
    ],
  };
}

describe('SkillsMutationInstaller', () => {
  let appDataDir: string;

  function teamSkillDir(teamName: string, slug: string): string {
    return path.join(appDataDir, 'skills', 'teams', teamName, slug);
  }

  function librarySkillDir(slug: string): string {
    return path.join(appDataDir, 'skills', 'library', slug);
  }

  async function seedSkill(skillDir: string, content = 'existing'): Promise<void> {
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), content);
  }

  beforeEach(async () => {
    appDataDir = await mkdtemp(path.join(tmpdir(), 'skills-installer-'));
    setAppDataBasePath(appDataDir);
  });

  afterEach(async () => {
    setAppDataBasePath(null);
    await rm(appDataDir, { recursive: true, force: true });
  });

  describe('a team owns its skills', () => {
    it('installs into the importing team store, not a runtime or project folder', async () => {
      const installer = new SkillsMutationInstaller();

      const result = await installer.install(skill('demo-skill'), {
        teamName: 'demo-team',
        projectPath: '/some/project',
      });

      expect(result).toEqual({ status: 'installed' });
      await expect(
        readFile(path.join(teamSkillDir('demo-team', 'demo-skill'), 'SKILL.md'), 'utf8')
      ).resolves.toContain('name: demo-skill');
      // Nested skill files travel with it.
      await expect(
        readFile(
          path.join(teamSkillDir('demo-team', 'demo-skill'), 'references', 'notes.md'),
          'utf8'
        )
      ).resolves.toBe('notes');
    });

    it('refuses to overwrite a skill the team already has', async () => {
      await seedSkill(teamSkillDir('demo-team', 'demo-skill'), 'local edits');
      const installer = new SkillsMutationInstaller();

      const result = await installer.install(skill('demo-skill'), { teamName: 'demo-team' });

      expect(result).toEqual({
        status: 'skipped',
        detail: 'already exists in skills/teams/demo-team',
      });
      await expect(
        readFile(path.join(teamSkillDir('demo-team', 'demo-skill'), 'SKILL.md'), 'utf8')
      ).resolves.toBe('local edits');
    });

    it('does not let two teams collide over a same-named skill', async () => {
      await seedSkill(teamSkillDir('other-team', 'legal-research'));
      const installer = new SkillsMutationInstaller();

      const result = await installer.install(skill('legal-research'), { teamName: 'demo-team' });

      expect(result.status).toBe('installed');
    });

    it('lists the team slugs, not another team or the library', async () => {
      await seedSkill(teamSkillDir('demo-team', 'team-skill'));
      await seedSkill(teamSkillDir('other-team', 'other-skill'));
      await seedSkill(librarySkillDir('library-skill'));
      const installer = new SkillsMutationInstaller();

      const slugs = await installer.listExistingSlugs({ teamName: 'demo-team' });

      expect([...slugs]).toEqual(['team-skill']);
    });

    it('reports a failure with the target instead of throwing', async () => {
      const installer = new SkillsMutationInstaller();

      const result = await installer.install(skill('demo-skill'), { teamName: '../escape' });

      expect(result.status).toBe('failed');
      expect(result.detail).toContain('../escape');
    });
  });

  // The preview runs before the team is named, so the only target left is the
  // shared library.
  describe('without a team name', () => {
    it('preserves references to skills already usable by the target project', async () => {
      let receivedScope: unknown;
      const installer = new SkillsMutationInstaller(new SkillStore(), {
        list: (scope) => {
          receivedScope = scope;
          return Promise.resolve([
            { folderName: 'project-skill' } as never,
            { folderName: 'personal-skill' } as never,
          ]);
        },
      });

      const slugs = await installer.listExistingSlugs({ projectPath: '/case/project' });

      expect(receivedScope).toBe('/case/project');
      expect([...slugs]).toEqual(['project-skill', 'personal-skill']);
    });

    it('installs into the shared library', async () => {
      const installer = new SkillsMutationInstaller();

      const result = await installer.install(skill('demo-skill'));

      expect(result).toEqual({ status: 'installed' });
      await expect(
        readFile(path.join(librarySkillDir('demo-skill'), 'SKILL.md'), 'utf8')
      ).resolves.toContain('name: demo-skill');
    });

    it('reports skipped when the library already has the slug', async () => {
      await seedSkill(librarySkillDir('demo-skill'));
      const installer = new SkillsMutationInstaller();

      const result = await installer.install(skill('demo-skill'));

      expect(result).toEqual({
        status: 'skipped',
        detail: 'already exists in skills/library',
      });
    });

    it('lists the library slugs', async () => {
      await seedSkill(librarySkillDir('library-skill'));
      await seedSkill(teamSkillDir('demo-team', 'team-skill'));
      const installer = new SkillsMutationInstaller();

      const slugs = await installer.listExistingSlugs();

      expect([...slugs]).toEqual(['library-skill']);
    });

    it('returns an empty set when nothing is installed yet', async () => {
      const installer = new SkillsMutationInstaller();

      await expect(installer.listExistingSlugs({ teamName: 'demo-team' })).resolves.toEqual(
        new Set()
      );
    });
  });
});
