import type { TeamImportBundleSkill } from '@features/team-import/contracts';

export type TeamImportSkillInstallStatus = 'installed' | 'skipped' | 'failed';

export interface TeamImportSkillInstallResult {
  status: TeamImportSkillInstallStatus;
  detail?: string;
}

/**
 * Where a team's skills belong. A team's skills are scoped to its project
 * folder, so they are discovered by exactly that team's agents and two teams
 * shipping a same-named skill no longer collide. A source with no project
 * folder (a URL import) has nothing to scope to and falls back to the user root.
 */
export interface TeamImportSkillTarget {
  projectPath: string;
}

export interface TeamImportSkillsInstallerPort {
  /** Slugs already present in the target's skill roots. */
  listExistingSlugs(target?: TeamImportSkillTarget): Promise<ReadonlySet<string>>;
  /** Installs one skill; existing slugs are never overwritten. */
  install(
    skill: TeamImportBundleSkill,
    target?: TeamImportSkillTarget
  ): Promise<TeamImportSkillInstallResult>;
}
