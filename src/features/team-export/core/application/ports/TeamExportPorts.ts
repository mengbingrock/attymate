import type { TeamExportSource } from '../../domain/teamExportPolicy';
import type { TeamExportFile } from '../../domain/teamExportPolicy';
import type { TeamImportBundleSkill } from '@features/team-import/contracts';

/** Reads a team's persisted state (team.meta.json, members.meta.json, agents/). */
export interface TeamExportSourceReaderPort {
  read(teamName: string): Promise<TeamExportSource>;
}

/** Resolves a skill slug to its files from the user's skill roots. */
export interface TeamExportSkillSourcePort {
  resolve(slug: string): Promise<TeamImportBundleSkill | null>;
}

export interface TeamExportWriteResult {
  folderPath: string;
  zipPath: string | null;
  zipError?: string;
}

export interface TeamExportWriterPort {
  write(input: {
    destinationPath: string;
    folderName: string;
    files: readonly TeamExportFile[];
    overwrite: boolean;
  }): Promise<TeamExportWriteResult>;
}

/** Native destination picker; null when the user cancels. */
export interface TeamExportDestinationPickerPort {
  chooseDestination(): Promise<string | null>;
}
