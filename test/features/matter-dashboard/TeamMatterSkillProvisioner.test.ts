import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  MATTER_SKILL_MARKDOWN,
  MATTER_SKILL_SLUG,
} from '@features/matter-dashboard/core/domain/matterSkillDefinition';
import { TeamMatterSkillProvisioner } from '@features/matter-dashboard/main';
import { SkillStore } from '@main/services/extensions/skills/SkillStore';
import { setAppDataBasePath } from '@main/utils/pathDecoder';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillProjectionService } from '@main/services/extensions/skills/SkillProjectionService';

let appData: string;
let store: SkillStore;

/** The exact v1 bundled markdown — a copy nobody has edited. */
const V1_SKILL_MARKDOWN = await fs.readFile(
  path.join(__dirname, 'fixtures', 'matter-skill-v1.md'),
  'utf8'
);

function createProvisioner(libraryMarkdown: string | null = null): TeamMatterSkillProvisioner {
  return new TeamMatterSkillProvisioner(store, () => Promise.resolve(libraryMarkdown));
}

function teamSkillFile(teamName: string): string {
  return path.join(appData, 'skills', 'teams', teamName, MATTER_SKILL_SLUG, 'SKILL.md');
}

beforeEach(async () => {
  appData = await fs.mkdtemp(path.join(os.tmpdir(), 'team-matter-skill-'));
  setAppDataBasePath(appData);
  store = new SkillStore();
});

afterEach(async () => {
  setAppDataBasePath(null);
  await fs.rm(appData, { recursive: true, force: true });
});

describe('TeamMatterSkillProvisioner', () => {
  it('gives a team its own copy, seeded from the bundled workflow', async () => {
    const ensured = await createProvisioner().ensure('alpha');

    expect(ensured?.source).toBe('seeded-from-bundled');
    expect(ensured?.filePath).toBe(teamSkillFile('alpha'));
    expect(await fs.readFile(teamSkillFile('alpha'), 'utf8')).toBe(MATTER_SKILL_MARKDOWN);
  });

  it('prefers the user-edited library copy when seeding', async () => {
    const edited = `${MATTER_SKILL_MARKDOWN}\n\n## House rules\nAlways cite the docket.\n`;

    const ensured = await createProvisioner(edited).ensure('alpha');

    expect(ensured?.source).toBe('seeded-from-library');
    expect(ensured?.markdown).toContain('House rules');
  });

  it('never overwrites a copy the team has edited', async () => {
    const provisioner = createProvisioner();
    await provisioner.ensure('alpha');
    const teamEdit = `${MATTER_SKILL_MARKDOWN}\n\n## Alpha only\nSkip settlement.\n`;
    await fs.writeFile(teamSkillFile('alpha'), teamEdit, 'utf8');

    const ensured = await provisioner.ensure('alpha');

    expect(ensured?.source).toBe('team');
    expect(ensured?.markdown).toBe(teamEdit);
  });

  it('refreshes a copy of a superseded bundled version', async () => {
    const provisioner = createProvisioner();
    await provisioner.ensure('alpha');
    await fs.writeFile(teamSkillFile('alpha'), V1_SKILL_MARKDOWN, 'utf8');

    const ensured = await provisioner.ensure('alpha');

    // Nobody edited it, so it must not stay pinned to a shipped older workflow.
    expect(ensured?.markdown).toBe(MATTER_SKILL_MARKDOWN);
  });

  it('keeps two teams independent', async () => {
    const provisioner = createProvisioner();
    await provisioner.ensure('alpha');
    await provisioner.ensure('beta');
    await fs.writeFile(teamSkillFile('alpha'), `${MATTER_SKILL_MARKDOWN}\n## Alpha\n`, 'utf8');

    const beta = await provisioner.ensure('beta');

    expect(beta?.markdown).not.toContain('## Alpha');
  });

  it('reports the path a lead is told to read', () => {
    expect(createProvisioner().resolveSkillFilePath('alpha')).toBe(teamSkillFile('alpha'));
  });

  it('returns null for a team name that cannot be a directory', async () => {
    // Rejecting the traversal is reported before returning null.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await createProvisioner().ensure('../escape')).toBeNull();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('keeps the store path free of any runtime name', async () => {
    const ensured = await createProvisioner().ensure('alpha');

    const relative = path.relative(appData, ensured!.filePath);
    expect(relative).not.toMatch(/claude|codex/i);
  });

  it('reclaims stale pointers before projecting every team skill into the launch project', async () => {
    await store.writeSkill(store.resolveTeamSkillDir('alpha', 'drafting'), [
      { relativePath: 'SKILL.md', content: '# Drafting\n' },
    ]);
    const projection = {
      releaseUnder: vi.fn(() => Promise.resolve()),
      project: vi.fn(() => Promise.resolve({ targets: [] })),
    } as unknown as SkillProjectionService;
    const provisioner = new TeamMatterSkillProvisioner(
      store,
      () => Promise.resolve(null),
      projection
    );

    await provisioner.project('alpha', '/case/project');

    expect(projection.releaseUnder).toHaveBeenCalledWith(store.resolveTeamSkillsDir('alpha'));
    expect(projection.project).toHaveBeenCalledWith(
      store.resolveTeamSkillDir('alpha', 'drafting'),
      'drafting',
      { projectPath: '/case/project' }
    );
    expect(vi.mocked(projection.releaseUnder).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(projection.project).mock.invocationCallOrder[0]!
    );
  });
});
