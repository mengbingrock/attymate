import type { TeamImportBundleSkill } from '@features/team-import/contracts';

export type TeamImportSkillInstallStatus = 'installed' | 'skipped' | 'failed';

export interface TeamImportSkillInstallResult {
  status: TeamImportSkillInstallStatus;
  detail?: string;
}

export interface TeamImportSkillsInstallerPort {
  /** Slugs already present in the user skill root (~/.claude/skills). */
  listExistingSlugs(): Promise<ReadonlySet<string>>;
  /** Installs one skill; existing slugs are never overwritten. */
  install(skill: TeamImportBundleSkill): Promise<TeamImportSkillInstallResult>;
}
