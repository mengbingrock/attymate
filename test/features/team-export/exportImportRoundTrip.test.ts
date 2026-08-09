import { mkdir, mkdtemp, readFile as readTextFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';

import { MATTER_SKILL_SLUG } from '@features/matter-dashboard/contracts';
import {
  assembleTeamExportBundle,
  buildTeamExportFiles,
  buildTeamExportMembers,
} from '@features/team-export/core/domain/teamExportPolicy';
import { createTeamExportFeature } from '@features/team-export/main/composition/createTeamExportFeature';
import { bundleToPreview, parseTeamImportBundle } from '@features/team-import/core';
import { buildTeamImportPreview } from '@features/team-import/core/domain/teamImportPolicy';
import { SkillsMutationInstaller } from '@features/team-import/main/infrastructure/SkillsMutationInstaller';
import { setAppDataBasePath } from '@main/utils/pathDecoder';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TeamExportWriterPort } from '@features/team-export/core/application/ports/TeamExportPorts';
import type { TeamExportFile, TeamExportSource } from '@features/team-export/core/domain/teamExportPolicy';
import type { TeamImportBundleSkill } from '@features/team-import/contracts';
import type { TeamImportFolderSnapshot } from '@features/team-import/core/application/models/TeamImportFolderSnapshot';

/**
 * Export and import are two halves of one contract, and both halves are pure
 * domain functions — so the round trip is testable end to end without Electron,
 * without a live team, and (crucially) without a model parse.
 */

/** Stand-in for the folder the user picked; nothing is read from disk here. */
const EXPORT_FOLDER_PATH = '/exports/ca-litigation-team-export';

function definition(name: string, role: string, skills: string[], body: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: ${role}`,
    ...(skills.length ? [`skills: [${skills.join(', ')}]`] : []),
    '---',
    '',
    body,
    '',
  ].join('\n');
}

const SOURCE: TeamExportSource = {
  teamName: 'ca-litigation-team',
  description: 'California litigation team',
  leadPrompt: 'Coordinate the matter and keep the board current.',
  members: [
    {
      name: 'calendar-agent',
      agentDefinitionMarkdown: definition(
        'calendar-agent',
        'Litigation Calendar Proposal Specialist',
        ['legal-calendaring-workflow'],
        'Derive and verify litigation deadlines from served documents.'
      ),
    },
    {
      name: 'docket-agent',
      role: 'Court Docket Review Specialist',
      workflow: 'Confirm docket entries against the public register.',
    },
  ],
};

const SKILLS: TeamImportBundleSkill[] = [
  {
    slug: 'legal-calendaring-workflow',
    description: 'Litigation calendaring workflow discipline.',
    files: [
      {
        relativePath: 'SKILL.md',
        content:
          '---\nname: legal-calendaring-workflow\ndescription: Litigation calendaring workflow discipline.\n---\n\nReusable legal skill for calendaring.\n',
      },
    ],
  },
];

function exportFiles(): TeamExportFile[] {
  const membersResult = buildTeamExportMembers(SOURCE);
  const { bundle } = assembleTeamExportBundle(SOURCE, membersResult, SKILLS);
  return buildTeamExportFiles(bundle);
}

function readFile(files: TeamExportFile[], relativePath: string): string {
  const file = files.find((candidate) => candidate.relativePath === relativePath);
  if (!file) throw new Error(`export is missing ${relativePath}`);
  return file.content;
}

/** What `SafeLocalTeamImportFolderSource` would produce for the export folder. */
function snapshotOf(files: TeamExportFile[], includeBundle: boolean): TeamImportFolderSnapshot {
  const bundleFile = files.find((file) => file.relativePath === 'team-import-bundle.json');
  return {
    projectPath: EXPORT_FOLDER_PATH,
    folderName: 'ca-litigation-team-export',
    agentFiles: files
      .filter((file) => file.relativePath.startsWith('agents/'))
      .map((file) => ({ fileName: file.relativePath.slice('agents/'.length), content: file.content })),
    claudeMd: files.find((file) => file.relativePath === 'TEAM.md')?.content,
    skills: files
      .filter((file) => file.relativePath.endsWith('/SKILL.md'))
      .map((file) => ({
        directoryName: file.relativePath.split('/').at(-2)!,
        content: file.content,
      })),
    ...(includeBundle && bundleFile ? { bundleJson: bundleFile.content } : {}),
    warnings: [],
  };
}

describe('export → import round trip', () => {
  it('restores every member with its real role and skills, through the bundle', () => {
    const files = exportFiles();
    const { bundle, blockingErrors } = parseTeamImportBundle(
      readFile(files, 'team-import-bundle.json')
    );

    expect(blockingErrors).toEqual([]);
    expect(bundle).not.toBeNull();

    const preview = bundleToPreview(bundle!, {
      projectPath: EXPORT_FOLDER_PATH,
      sourceLabel: 'ca-litigation-team-export (team bundle)',
      existingSkillSlugs: new Set<string>(),
    });

    expect(preview.blockingErrors).toEqual([]);
    expect(preview.members.map((member) => member.name)).toEqual([
      'calendar-agent',
      'docket-agent',
    ]);
    expect(preview.members.map((member) => member.role)).toEqual([
      'Litigation Calendar Proposal Specialist',
      'Court Docket Review Specialist',
    ]);
    expect(preview.skillsFound).toEqual(['legal-calendaring-workflow']);
    expect(preview.skillPlans?.map((plan) => plan.slug)).toEqual(['legal-calendaring-workflow']);
    // The format is model-agnostic: no member arrives pinned to a model, so
    // the importing team's own provider choice decides what they run on.
    expect(preview.members.every((member) => member.model === undefined)).toBe(true);
    // The skill assignment travels onto the new team's roster.
    expect(preview.members.map((member) => member.skills)).toEqual([
      ['legal-calendaring-workflow'],
      undefined,
    ]);
    expect(preview.memberDetails?.find((detail) => detail.name === 'calendar-agent')?.skills).toEqual(
      ['legal-calendaring-workflow']
    );
  });

  it('still recovers the whole roster from the markdown when the bundle is removed', () => {
    const files = exportFiles();

    const preview = buildTeamImportPreview(snapshotOf(files, false));

    expect(preview.blockingErrors).toEqual([]);
    expect(preview.members.map((member) => member.name)).toEqual([
      'calendar-agent',
      'docket-agent',
    ]);
    // The markdown path reads roles from `description:`, which is exactly what
    // the exported agent files carry.
    expect(preview.members.map((member) => member.role)).toEqual([
      'Litigation Calendar Proposal Specialist',
      'Court Docket Review Specialist',
    ]);
    expect(preview.skillsFound).toEqual(['legal-calendaring-workflow']);
  });

  it('ignores model pins in bundles from older exports', () => {
    // Bundles written before the format went model-agnostic pin every member
    // to the exporting machine's model. Importing one must not resurrect the
    // pin — the user's provider choice decides.
    const legacyBundle = JSON.stringify({
      schema: 'team-import-bundle/v1',
      team: { name: 'legacy-team' },
      members: [
        {
          name: 'calendar-agent',
          role: 'Calendar Specialist',
          workflow: 'Derive deadlines.',
          skills: [],
          memoryFiles: [],
          agentDefinition: { model: 'claude-sonnet-5' },
        },
      ],
      skills: [],
    });

    const { bundle } = parseTeamImportBundle(legacyBundle);
    const preview = bundleToPreview(bundle!, {
      projectPath: EXPORT_FOLDER_PATH,
      sourceLabel: 'legacy',
      existingSkillSlugs: new Set<string>(),
    });

    expect(preview.members[0].model).toBeUndefined();
  });

  it('carries no memory, matter, or machine-specific paths in the exported files', () => {
    for (const file of exportFiles()) {
      expect(file.relativePath).not.toContain('memory/');
      expect(file.content).not.toContain('/Users/');
      expect(file.content).not.toContain('matter.json');
    }
  });
});

/**
 * The same round trip through the real store-backed adapters: what a team owns
 * in `<userData>/skills/teams/<team>` is exactly what travels, and it lands in
 * the importing team's own store — no runtime folder and no project folder is
 * involved on either side.
 */
describe('a team-owned skill survives the round trip through the skill store', () => {
  let appDataDir: string;
  let teamsBasePath: string;

  const SKILL_MARKDOWN =
    '---\nname: team-only-skill\ndescription: Only this team has it.\n---\n\nDo the team-owned work.\n';
  const MATTER_SKILL_MARKDOWN =
    '---\nname: matter-dashboard\ndescription: Keep the matter dashboard current.\n---\n\nPropose grounded dashboard updates.\n';

  function teamSkillDir(teamName: string, slug: string): string {
    return nodePath.join(appDataDir, 'skills', 'teams', teamName, slug);
  }

  beforeEach(async () => {
    appDataDir = await mkdtemp(nodePath.join(tmpdir(), 'team-skill-roundtrip-'));
    teamsBasePath = await mkdtemp(nodePath.join(tmpdir(), 'team-skill-roundtrip-teams-'));
    setAppDataBasePath(appDataDir);

    // The required dashboard workflow exists in the shared library before an
    // unlaunched team receives its own projected copy.
    const matterSkillDir = nodePath.join(
      appDataDir,
      'skills',
      'library',
      MATTER_SKILL_SLUG
    );
    await mkdir(matterSkillDir, { recursive: true });
    await writeFile(nodePath.join(matterSkillDir, 'SKILL.md'), MATTER_SKILL_MARKDOWN);

    // The exporting team: one member, and a skill only its own store holds.
    const teamDir = nodePath.join(teamsBasePath, 'source-team');
    await mkdir(teamDir, { recursive: true });
    await writeFile(
      nodePath.join(teamDir, 'team.meta.json'),
      JSON.stringify({ description: 'Source team', prompt: 'Coordinate.' })
    );
    await writeFile(
      nodePath.join(teamDir, 'members.meta.json'),
      JSON.stringify({
        members: [{ name: 'docket-agent', role: 'Docket Specialist', workflow: 'Check the docket.' }],
      })
    );
    const skillDir = teamSkillDir('source-team', 'team-only-skill');
    await mkdir(nodePath.join(skillDir, 'references'), { recursive: true });
    await writeFile(nodePath.join(skillDir, 'SKILL.md'), SKILL_MARKDOWN);
    await writeFile(nodePath.join(skillDir, 'references', 'checklist.md'), 'Checklist.\n');
  });

  afterEach(async () => {
    setAppDataBasePath(null);
    await rm(appDataDir, { recursive: true, force: true });
    await rm(teamsBasePath, { recursive: true, force: true });
  });

  it('exports from the owning team store and imports into the new team store', async () => {
    let written: readonly TeamExportFile[] = [];
    const writer: TeamExportWriterPort = {
      write: (input) => {
        written = input.files;
        return Promise.resolve({ folderPath: '/exports/source-team-export', zipPath: null });
      },
    };
    const feature = createTeamExportFeature({
      teamsBasePath,
      writer,
      destinationPicker: { chooseDestination: () => Promise.resolve('/exports') },
    });

    const result = await feature.exportTeam({ teamName: 'source-team' });

    // No member names the slug: the team's own store is what puts it in the
    // package.
    expect(result?.skillSlugs).toEqual([MATTER_SKILL_SLUG, 'team-only-skill']);
    expect(written.map((file) => file.relativePath)).toContain(
      `skills/${MATTER_SKILL_SLUG}/SKILL.md`
    );
    expect(written.map((file) => file.relativePath)).toContain(
      'skills/team-only-skill/references/checklist.md'
    );

    const bundleJson = written.find(
      (file) => file.relativePath === 'team-import-bundle.json'
    )!.content;
    const { bundle, blockingErrors } = parseTeamImportBundle(bundleJson);
    expect(blockingErrors).toEqual([]);
    const teamOnlySkill = bundle!.skills.find((candidate) => candidate.slug === 'team-only-skill');
    expect(teamOnlySkill).toMatchObject({
      slug: 'team-only-skill',
      description: 'Only this team has it.',
    });

    const installer = new SkillsMutationInstaller();
    const installed = await installer.install(teamOnlySkill!, { teamName: 'imported-team' });

    expect(installed).toEqual({ status: 'installed' });
    await expect(
      readTextFile(nodePath.join(teamSkillDir('imported-team', 'team-only-skill'), 'SKILL.md'), 'utf8')
    ).resolves.toBe(SKILL_MARKDOWN);
    await expect(
      readTextFile(
        nodePath.join(teamSkillDir('imported-team', 'team-only-skill'), 'references', 'checklist.md'),
        'utf8'
      )
    ).resolves.toBe('Checklist.\n');
  });
});
