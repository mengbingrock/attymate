import { MATTER_SKILL_SLUG } from '@features/matter-dashboard/contracts';
import { ExportTeamUseCase } from '@features/team-export/core/application/use-cases/ExportTeamUseCase';
import { TEAM_EXPORT_LIMITS } from '@features/team-export/core/domain/teamExportPolicy';
import { describe, expect, it, vi } from 'vitest';

import type {
  TeamExportSkillSourcePort,
  TeamExportSourceReaderPort,
  TeamExportWriterPort,
} from '@features/team-export/core/application/ports/TeamExportPorts';
import type { TeamExportSource } from '@features/team-export/core/domain/teamExportPolicy';
import type { TeamImportBundleSkill } from '@features/team-import/contracts';

function skill(slug: string): TeamImportBundleSkill {
  return {
    slug,
    description: `${slug} workflow`,
    files: [
      {
        relativePath: 'SKILL.md',
        content: `---\nname: ${slug}\ndescription: ${slug} workflow\n---\n\nDo the work.\n`,
      },
    ],
  };
}

function source(overrides: Partial<TeamExportSource> = {}): TeamExportSource {
  return {
    teamName: 'unlaunched-team',
    members: [{ name: 'docket-agent', role: 'Docket Specialist', workflow: 'Check the docket.' }],
    ...overrides,
  };
}

function setup(teamSource: TeamExportSource) {
  const resolvedSlugs: string[] = [];
  const sourceReader: TeamExportSourceReaderPort = {
    read: vi.fn().mockResolvedValue(teamSource),
  };
  const skillSource: TeamExportSkillSourcePort = {
    resolve: vi.fn(async (slug) => {
      resolvedSlugs.push(slug);
      return skill(slug);
    }),
  };
  const writer: TeamExportWriterPort = {
    write: vi.fn().mockResolvedValue({
      folderPath: '/exports/unlaunched-team-export',
      zipPath: null,
    }),
  };
  const useCase = new ExportTeamUseCase(sourceReader, skillSource, writer, {
    chooseDestination: vi.fn().mockResolvedValue('/exports'),
  });

  return { resolvedSlugs, useCase };
}

describe('ExportTeamUseCase required skills', () => {
  it('exports matter-dashboard even when an unlaunched team does not reference it yet', async () => {
    const { resolvedSlugs, useCase } = setup(source());

    const result = await useCase.execute({ teamName: 'unlaunched-team' });

    expect(resolvedSlugs).toEqual([MATTER_SKILL_SLUG]);
    expect(result?.skillSlugs).toEqual([MATTER_SKILL_SLUG]);
  });

  it('prioritizes matter-dashboard so the skill limit cannot drop it', async () => {
    const referencedSlugs = Array.from(
      { length: TEAM_EXPORT_LIMITS.maxSkills },
      (_unused, index) => `team-skill-${index}`
    );
    const { resolvedSlugs, useCase } = setup(source({ teamSkillSlugs: referencedSlugs }));

    const result = await useCase.execute({ teamName: 'unlaunched-team' });

    expect(resolvedSlugs[0]).toBe(MATTER_SKILL_SLUG);
    expect(result?.skillSlugs).toHaveLength(TEAM_EXPORT_LIMITS.maxSkills);
    expect(result?.skillSlugs[0]).toBe(MATTER_SKILL_SLUG);
    expect(result?.warnings).toContainEqual({
      code: 'skillLimitExceeded',
      dropped: 1,
      limit: TEAM_EXPORT_LIMITS.maxSkills,
    });
  });
});
