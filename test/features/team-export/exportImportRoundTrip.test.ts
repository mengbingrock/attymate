import {
  assembleTeamExportBundle,
  buildTeamExportFiles,
  buildTeamExportMembers,
} from '@features/team-export/core/domain/teamExportPolicy';
import { bundleToPreview, parseTeamImportBundle } from '@features/team-import/core';
import { buildTeamImportPreview } from '@features/team-import/core/domain/teamImportPolicy';
import { describe, expect, it } from 'vitest';

import type { TeamExportFile, TeamExportSource } from '@features/team-export/core/domain/teamExportPolicy';
import type { TeamImportFolderSnapshot } from '@features/team-import/core/application/models/TeamImportFolderSnapshot';
import type { TeamImportBundleSkill } from '@features/team-import/contracts';

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
      model: 'gpt-5.6-sol',
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
    claudeMd: files.find((file) => file.relativePath === '.claude/CLAUDE.md')?.content,
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
    // The model each member ran under travels with it.
    expect(preview.members.map((member) => member.model)).toEqual(['gpt-5.6-sol', undefined]);
    // …and so does its skill assignment, onto the new team's roster.
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

  it('carries no memory, matter, or machine-specific paths in the exported files', () => {
    for (const file of exportFiles()) {
      expect(file.relativePath).not.toContain('memory/');
      expect(file.content).not.toContain('/Users/');
      expect(file.content).not.toContain('matter.json');
    }
  });
});
