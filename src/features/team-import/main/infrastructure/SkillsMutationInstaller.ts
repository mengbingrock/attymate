import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { getHomeDir } from '@main/utils/pathDecoder';

import type {
  TeamImportSkillInstallResult,
  TeamImportSkillsInstallerPort,
  TeamImportSkillTarget,
} from '../../core/application/ports/TeamImportSkillsInstallerPort';
import type { TeamImportBundleSkill } from '@features/team-import/contracts';
import type { SkillsMutationService } from '@main/services/extensions/skills/SkillsMutationService';

interface SkillInstallTarget {
  scope: 'user' | 'project';
  rootKind: 'claude' | 'codex';
  rootPath: string;
  projectPath?: string;
  label: string;
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    return (await fs.stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Installs an imported team's skills into that team's own project folder, into
 * every skill root an assigned runtime may read: stock Claude discovers
 * `<project>/.claude/skills` and stock Codex `<project>/.codex/skills`, and the
 * team's provider is chosen after import — so the skill lands in both (Codex
 * only when ~/.codex exists on the machine).
 *
 * Project scope is what ties a skill to the team that shipped it: the folder is
 * the team's skill library, it travels with the project, and two teams that both
 * ship a "legal-research" skill no longer overwrite or shadow each other.
 * Sources with no project folder (URL imports) fall back to the user root.
 *
 * Existing slugs are never touched in any root: the user chose skip-and-warn
 * over overwrite for conflicts.
 */
export class SkillsMutationInstaller implements TeamImportSkillsInstallerPort {
  constructor(
    private readonly skillsMutationService: SkillsMutationService,
    private readonly homeDir: string = getHomeDir()
  ) {}

  private async getTargets(target?: TeamImportSkillTarget): Promise<SkillInstallTarget[]> {
    const projectPath = target?.projectPath?.trim();
    const codexInstalled = await directoryExists(path.join(this.homeDir, '.codex'));

    if (!projectPath) {
      // No project folder to scope to (URL import): keep the skills usable by
      // falling back to the user-wide roots.
      const userTargets: SkillInstallTarget[] = [
        {
          scope: 'user',
          rootKind: 'claude',
          rootPath: path.join(this.homeDir, '.claude', 'skills'),
          label: '~/.claude/skills',
        },
      ];
      if (codexInstalled) {
        userTargets.push({
          scope: 'user',
          rootKind: 'codex',
          rootPath: path.join(this.homeDir, '.codex', 'skills'),
          label: '~/.codex/skills',
        });
      }
      return userTargets;
    }

    const targets: SkillInstallTarget[] = [
      {
        scope: 'project',
        rootKind: 'claude',
        rootPath: path.join(projectPath, '.claude', 'skills'),
        projectPath,
        label: `${projectPath}/.claude/skills`,
      },
    ];
    if (codexInstalled) {
      targets.push({
        scope: 'project',
        rootKind: 'codex',
        rootPath: path.join(projectPath, '.codex', 'skills'),
        projectPath,
        label: `${projectPath}/.codex/skills`,
      });
    }
    return targets;
  }

  private async listRootSlugs(rootPath: string): Promise<ReadonlySet<string>> {
    try {
      const entries = await fs.readdir(rootPath, { withFileTypes: true });
      return new Set(
        entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name.toLowerCase())
      );
    } catch {
      return new Set();
    }
  }

  async listExistingSlugs(target?: TeamImportSkillTarget): Promise<ReadonlySet<string>> {
    const union = new Set<string>();
    for (const installTarget of await this.getTargets(target)) {
      for (const slug of await this.listRootSlugs(installTarget.rootPath)) union.add(slug);
    }
    return union;
  }

  async install(
    skill: TeamImportBundleSkill,
    target?: TeamImportSkillTarget
  ): Promise<TeamImportSkillInstallResult> {
    const targets = await this.getTargets(target);
    const installedTo: string[] = [];
    const skippedAt: string[] = [];
    const failures: string[] = [];

    for (const installTarget of targets) {
      const existing = await this.listRootSlugs(installTarget.rootPath);
      if (existing.has(skill.slug.toLowerCase())) {
        skippedAt.push(installTarget.label);
        continue;
      }
      try {
        const files = skill.files.map((file) => ({
          relativePath: file.relativePath,
          content: file.content,
        }));
        const request = {
          scope: installTarget.scope,
          rootKind: installTarget.rootKind,
          folderName: skill.slug,
          files,
          ...(installTarget.projectPath ? { projectPath: installTarget.projectPath } : {}),
        };
        const preview = await this.skillsMutationService.previewUpsert(request);
        await this.skillsMutationService.applyUpsert({ ...request, reviewPlanId: preview.planId });
        installedTo.push(installTarget.label);
      } catch (error) {
        failures.push(
          `${installTarget.label}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (failures.length > 0) {
      return { status: 'failed', detail: failures.join('; ') };
    }
    if (installedTo.length === 0) {
      return { status: 'skipped', detail: `already exists in ${skippedAt.join(' and ')}` };
    }
    return {
      status: 'installed',
      ...(skippedAt.length > 0
        ? {
            detail: `installed to ${installedTo.join(' and ')}; already existed in ${skippedAt.join(' and ')}`,
          }
        : {}),
    };
  }
}
