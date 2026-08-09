import { ExportTeamUseCase } from '../../core/application/use-cases/ExportTeamUseCase';
import { ElectronExportDestinationPicker } from '../infrastructure/ElectronExportDestinationPicker';
import { TeamExportFolderWriter } from '../infrastructure/TeamExportFolderWriter';
import { TeamExportSkillSource } from '../infrastructure/TeamExportSkillSource';
import { TeamExportSourceReader } from '../infrastructure/TeamExportSourceReader';

import type { TeamExportRequest, TeamExportResult } from '../../contracts';
import type {
  TeamExportDestinationPickerPort,
  TeamExportSkillSourcePort,
  TeamExportSourceReaderPort,
  TeamExportWriterPort,
} from '../../core/application/ports/TeamExportPorts';

export interface TeamExportFeatureFacade {
  /** Null when the user cancels the destination picker. */
  exportTeam(request: TeamExportRequest): Promise<TeamExportResult | null>;
}

export interface CreateTeamExportFeatureDeps {
  teamsBasePath: string;
  /** Test seams; production uses the local filesystem and Electron dialog. */
  sourceReader?: TeamExportSourceReaderPort;
  skillSource?: TeamExportSkillSourcePort;
  writer?: TeamExportWriterPort;
  destinationPicker?: TeamExportDestinationPickerPort;
}

export function createTeamExportFeature(
  deps: CreateTeamExportFeatureDeps
): TeamExportFeatureFacade {
  // The skill source is scoped to the exported team — its own store first, its
  // project folder second — and the source reader asks it which skills each of
  // those holds, so both halves work from the same lookup.
  const skillSource = deps.skillSource ?? new TeamExportSkillSource();
  const scopedSkillSource = skillSource instanceof TeamExportSkillSource ? skillSource : null;

  const sourceReader =
    deps.sourceReader ??
    new TeamExportSourceReader(
      deps.teamsBasePath,
      async (projectPath) => {
        scopedSkillSource?.setProjectPath(projectPath);
        return (await scopedSkillSource?.listProjectSlugs(projectPath)) ?? [];
      },
      async (teamName) => {
        scopedSkillSource?.setTeamName(teamName);
        return (await scopedSkillSource?.listTeamSlugs(teamName)) ?? [];
      }
    );

  const useCase = new ExportTeamUseCase(
    sourceReader,
    skillSource,
    deps.writer ?? new TeamExportFolderWriter(),
    deps.destinationPicker ?? new ElectronExportDestinationPicker()
  );
  return {
    exportTeam: (request) => useCase.execute(request),
  };
}
