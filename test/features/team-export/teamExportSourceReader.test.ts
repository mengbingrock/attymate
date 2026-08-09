import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { TeamExportSourceReader } from '@features/team-export/main/infrastructure/TeamExportSourceReader';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('TeamExportSourceReader', () => {
  let teamsBasePath: string;
  let teamDir: string;

  async function writeTeam(
    teamMeta: Record<string, unknown>,
    members: Record<string, unknown>[] = [{ name: 'docket-agent', workflow: 'Check the docket.' }]
  ): Promise<void> {
    await mkdir(teamDir, { recursive: true });
    await writeFile(path.join(teamDir, 'team.meta.json'), JSON.stringify(teamMeta));
    await writeFile(path.join(teamDir, 'members.meta.json'), JSON.stringify({ members }));
  }

  beforeEach(async () => {
    teamsBasePath = await mkdtemp(path.join(tmpdir(), 'team-export-reader-'));
    teamDir = path.join(teamsBasePath, 'ca-team');
  });

  afterEach(async () => {
    await rm(teamsBasePath, { recursive: true, force: true });
  });

  it('reads the lead skills from team.meta.json', async () => {
    // The lead is never exported as an agent, so this is the only record of
    // what it was assigned — dropping it lost lead-only skills.
    await writeTeam({
      description: 'California litigation team',
      prompt: 'Coordinate the matter.',
      lead: { name: 'team-lead', skills: ['matter-dashboard', 'legal-research', 'matter-dashboard'] },
    });
    const reader = new TeamExportSourceReader(teamsBasePath);

    const source = await reader.read('ca-team');

    expect(source.leadSkillSlugs).toEqual(['matter-dashboard', 'legal-research']);
    expect(source.description).toBe('California litigation team');
    expect(source.leadPrompt).toBe('Coordinate the matter.');
  });

  it('omits lead skills when the lead has none or the meta is malformed', async () => {
    await writeTeam({ lead: { name: 'team-lead', skills: [42, '  '] } });
    const reader = new TeamExportSourceReader(teamsBasePath);

    await expect(reader.read('ca-team')).resolves.toMatchObject({ teamName: 'ca-team' });
    await expect(
      reader.read('ca-team').then((source) => source.leadSkillSlugs)
    ).resolves.toBeUndefined();
  });

  it('asks the store for the slugs the team owns', async () => {
    await writeTeam({ cwd: '/project' });
    const listTeamSkillSlugs = vi.fn().mockResolvedValue(['team-store-skill']);
    const listProjectSkillSlugs = vi.fn().mockResolvedValue(['legacy-project-skill']);
    const reader = new TeamExportSourceReader(
      teamsBasePath,
      listProjectSkillSlugs,
      listTeamSkillSlugs
    );

    const source = await reader.read('ca-team');

    expect(listTeamSkillSlugs).toHaveBeenCalledWith('ca-team');
    expect(source.teamSkillSlugs).toEqual(['team-store-skill']);
    expect(source.projectSkillSlugs).toEqual(['legacy-project-skill']);
    expect(source.members.map((member) => member.name)).toEqual(['docket-agent']);
  });
});
