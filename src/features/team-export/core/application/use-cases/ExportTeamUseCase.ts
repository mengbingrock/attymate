import { suggestTeamImportName } from '@features/team-import/core';

import {
  assembleTeamExportBundle,
  buildTeamExportFiles,
  buildTeamExportMembers,
} from '../../domain/teamExportPolicy';

import type { TeamExportRequest, TeamExportResult, TeamExportWarning } from '../../../contracts';
import type {
  TeamExportDestinationPickerPort,
  TeamExportSkillSourcePort,
  TeamExportSourceReaderPort,
  TeamExportWriterPort,
} from '../ports/TeamExportPorts';
import type { TeamImportBundleSkill } from '@features/team-import/contracts';

export class ExportTeamUseCase {
  constructor(
    private readonly sourceReader: TeamExportSourceReaderPort,
    private readonly skillSource: TeamExportSkillSourcePort,
    private readonly writer: TeamExportWriterPort,
    private readonly destinationPicker: TeamExportDestinationPickerPort
  ) {}

  /** Returns null when the user cancels the destination picker. */
  async execute(request: TeamExportRequest): Promise<TeamExportResult | null> {
    const teamName = request.teamName?.trim();
    if (!teamName) throw new Error('teamName is required');

    const destinationPath =
      request.destinationPath ?? (await this.destinationPicker.chooseDestination());
    if (!destinationPath) return null;

    const source = await this.sourceReader.read(teamName);
    const membersResult = buildTeamExportMembers(source);

    const warnings: TeamExportWarning[] = [];
    const skills: TeamImportBundleSkill[] = [];
    for (const slug of membersResult.referencedSlugs) {
      const skill = await this.skillSource.resolve(slug);
      if (skill) {
        skills.push(skill);
        continue;
      }
      warnings.push({
        code: 'skillMissing',
        slug,
        requestedBy:
          membersResult.members.find((member) => member.skills.includes(slug))?.name ?? teamName,
      });
    }

    const { bundle, warnings: bundleWarnings } = assembleTeamExportBundle(
      source,
      membersResult,
      skills
    );
    if (bundle.members.length === 0) {
      return {
        exported: false,
        folderPath: null,
        zipPath: null,
        memberCount: 0,
        skillSlugs: [],
        warnings: [...warnings, ...bundleWarnings],
        message: 'This team has no exportable agents.',
      };
    }

    const written = await this.writer.write({
      destinationPath,
      folderName: `${suggestTeamImportName(teamName)}-export`,
      files: buildTeamExportFiles(bundle),
      overwrite: request.overwrite === true,
    });
    if (written.zipError) {
      warnings.push({ code: 'zipFailed', reason: written.zipError });
    }

    const skillSlugs = bundle.skills.map((skill) => skill.slug);
    return {
      exported: true,
      folderPath: written.folderPath,
      zipPath: written.zipPath,
      memberCount: bundle.members.length,
      skillSlugs,
      warnings: [...warnings, ...bundleWarnings],
      message: `Exported ${bundle.members.length} agent${
        bundle.members.length === 1 ? '' : 's'
      } and ${skillSlugs.length} skill${skillSlugs.length === 1 ? '' : 's'}.`,
    };
  }
}
