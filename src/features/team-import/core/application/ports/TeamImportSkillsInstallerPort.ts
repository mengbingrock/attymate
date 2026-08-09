import type { TeamImportBundleSkill } from '@features/team-import/contracts';

export type TeamImportSkillInstallStatus = 'installed' | 'skipped' | 'failed';

export interface TeamImportSkillInstallResult {
  status: TeamImportSkillInstallStatus;
  detail?: string;
}

/**
 * Where a team's skills belong: the team's own store in the app's
 * model-agnostic skill storage. A team outlives the project folder it happens
 * to launch in, so the folder is no longer the carrier — a launch-time
 * projection restores runtime discovery. Before the team is named, preview
 * uses the project path only to discover references that are already usable;
 * it does not install into that folder.
 */
export interface TeamImportSkillTarget {
  /** The importing team; the primary and preferred target. */
  teamName?: string;
  /**
   * The source's folder. Accepted for callers that only know a folder (the
   * preview runs before the team is named); nothing installs there anymore.
   */
  projectPath?: string;
}

export interface TeamImportSkillsInstallerPort {
  /** Slugs already usable by the target, or already owned by the named team. */
  listExistingSlugs(target?: TeamImportSkillTarget): Promise<ReadonlySet<string>>;
  /** Installs one skill; existing slugs are never overwritten. */
  install(
    skill: TeamImportBundleSkill,
    target?: TeamImportSkillTarget
  ): Promise<TeamImportSkillInstallResult>;
}
