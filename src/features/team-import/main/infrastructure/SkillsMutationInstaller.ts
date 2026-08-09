import { getLibrarySkillsRootPath } from '@main/services/extensions/skills/SkillRootsResolver';
import { SkillsCatalogService } from '@main/services/extensions/skills/SkillsCatalogService';
import { SkillStore } from '@main/services/extensions/skills/SkillStore';

import type {
  TeamImportSkillInstallResult,
  TeamImportSkillsInstallerPort,
  TeamImportSkillTarget,
} from '../../core/application/ports/TeamImportSkillsInstallerPort';
import type { TeamImportBundleSkill } from '@features/team-import/contracts';

interface SkillInstallTarget {
  skillsDir: string;
  resolveSkillDir(slug: string): string;
  label: string;
}

/** Names a target for warnings, including one the store itself rejects. */
function describeTarget(target?: TeamImportSkillTarget): string {
  const teamName = target?.teamName?.trim();
  return teamName ? `skills/teams/${teamName}` : 'skills/library';
}

/**
 * Installs an imported team's skills into that team's own store
 * (`<userData>/skills/teams/<team>/<slug>`).
 *
 * The team store — not a runtime-branded folder and not the project folder — is
 * what ties a skill to the team that shipped it: the store is model-agnostic,
 * it survives the project folder changing (a project is a launch parameter, not
 * the team's home), and two teams that both ship a "legal-research" skill no
 * longer overwrite or shadow each other. Runtime discovery is restored at
 * launch by the projection service, so nothing is written into
 * `<project>/.claude/skills` or `~/.claude/skills` here anymore.
 *
 * A caller with no team name yet (the preview, which runs before the team is
 * named) falls back to the shared library.
 *
 * Existing slugs are never touched: the user chose skip-and-warn over overwrite
 * for conflicts.
 */
export class SkillsMutationInstaller implements TeamImportSkillsInstallerPort {
  constructor(
    private readonly store: SkillStore = new SkillStore(),
    private readonly catalog: Pick<SkillsCatalogService, 'list'> = new SkillsCatalogService()
  ) {}

  private getTarget(target?: TeamImportSkillTarget): SkillInstallTarget {
    const teamName = target?.teamName?.trim();
    if (teamName) {
      return {
        skillsDir: this.store.resolveTeamSkillsDir(teamName),
        resolveSkillDir: (slug) => this.store.resolveTeamSkillDir(teamName, slug),
        label: `skills/teams/${teamName}`,
      };
    }
    return {
      skillsDir: getLibrarySkillsRootPath(),
      resolveSkillDir: (slug) => this.store.resolveLibrarySkillDir(slug),
      label: 'skills/library',
    };
  }

  async listExistingSlugs(target?: TeamImportSkillTarget): Promise<ReadonlySet<string>> {
    const teamName = target?.teamName?.trim();
    if (teamName) {
      try {
        const slugs = await this.store.listTeamSlugs(teamName);
        return new Set(slugs.map((slug) => slug.toLowerCase()));
      } catch {
        // An unusable team name owns nothing; the caller only wants conflicts.
        return new Set();
      }
    }

    // Preview happens before the final team name exists. Preserve references
    // to every skill the target project can already use (project, library, and
    // legacy user roots), rather than pruning those references as unknown.
    try {
      const projectPath = target?.projectPath?.trim();
      const items = await this.catalog.list(projectPath || undefined);
      return new Set(items.map((item) => item.folderName.toLowerCase()));
    } catch {
      const slugs = await this.store.listSlugs(getLibrarySkillsRootPath());
      return new Set(slugs.map((slug) => slug.toLowerCase()));
    }
  }

  async install(
    skill: TeamImportBundleSkill,
    target?: TeamImportSkillTarget
  ): Promise<TeamImportSkillInstallResult> {
    try {
      const installTarget = this.getTarget(target);
      const outcome = await this.store.writeSkill(
        installTarget.resolveSkillDir(skill.slug),
        skill.files.map((file) => ({
          relativePath: file.relativePath,
          content: file.content,
        }))
      );
      return outcome === 'skipped'
        ? { status: 'skipped', detail: `already exists in ${installTarget.label}` }
        : { status: 'installed' };
    } catch (error) {
      return {
        status: 'failed',
        detail: `${describeTarget(target)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
