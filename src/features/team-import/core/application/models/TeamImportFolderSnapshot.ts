import type { TeamImportWarning } from '@features/team-import/contracts';

export interface TeamImportSourceFile {
  fileName: string;
  content: string;
}

export interface TeamImportSkillDefinition {
  directoryName: string;
  content: string;
}

export interface TeamImportFolderSnapshot {
  projectPath: string;
  folderName: string;
  agentFiles: TeamImportSourceFile[];
  claudeMd?: string;
  skills: TeamImportSkillDefinition[];
  /**
   * Raw `team-import-bundle.json` when the folder carries one (an app export).
   * It re-imports deterministically with full fidelity — roles, models, agent
   * files, and skills — where the markdown scan can only recover names,
   * skills, and workflow text.
   */
  bundleJson?: string;
  warnings: TeamImportWarning[];
}
