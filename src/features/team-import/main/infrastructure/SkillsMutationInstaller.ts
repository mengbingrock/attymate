import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { getHomeDir } from '@main/utils/pathDecoder';

import type {
  TeamImportSkillInstallResult,
  TeamImportSkillsInstallerPort,
} from '../../core/application/ports/TeamImportSkillsInstallerPort';
import type { TeamImportBundleSkill } from '@features/team-import/contracts';
import type { SkillsMutationService } from '@main/services/extensions/skills/SkillsMutationService';

interface SkillInstallTarget {
  rootKind: 'claude' | 'codex';
  rootPath: string;
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
 * Installs imported skills into every user skill root an assigned runtime may
 * read. Stock Claude discovers only ~/.claude/skills and stock Codex discovers
 * ~/.codex/skills, and the team's provider is chosen after import — so the
 * skill lands in both roots (Codex only when ~/.codex exists on the machine).
 * Existing slugs are never touched in any root: the user chose skip-and-warn
 * over overwrite for conflicts.
 */
export class SkillsMutationInstaller implements TeamImportSkillsInstallerPort {
  constructor(
    private readonly skillsMutationService: SkillsMutationService,
    private readonly homeDir: string = getHomeDir()
  ) {}

  private async getTargets(): Promise<SkillInstallTarget[]> {
    const targets: SkillInstallTarget[] = [
      {
        rootKind: 'claude',
        rootPath: path.join(this.homeDir, '.claude', 'skills'),
        label: '~/.claude/skills',
      },
    ];
    // Only offer the Codex root when Codex is actually set up on this machine.
    if (await directoryExists(path.join(this.homeDir, '.codex'))) {
      targets.push({
        rootKind: 'codex',
        rootPath: path.join(this.homeDir, '.codex', 'skills'),
        label: '~/.codex/skills',
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

  async listExistingSlugs(): Promise<ReadonlySet<string>> {
    const union = new Set<string>();
    for (const target of await this.getTargets()) {
      for (const slug of await this.listRootSlugs(target.rootPath)) union.add(slug);
    }
    return union;
  }

  async install(skill: TeamImportBundleSkill): Promise<TeamImportSkillInstallResult> {
    const targets = await this.getTargets();
    const installedTo: string[] = [];
    const skippedAt: string[] = [];
    const failures: string[] = [];

    for (const target of targets) {
      const existing = await this.listRootSlugs(target.rootPath);
      if (existing.has(skill.slug.toLowerCase())) {
        skippedAt.push(target.label);
        continue;
      }
      try {
        const files = skill.files.map((file) => ({
          relativePath: file.relativePath,
          content: file.content,
        }));
        const preview = await this.skillsMutationService.previewUpsert({
          scope: 'user',
          rootKind: target.rootKind,
          folderName: skill.slug,
          files,
        });
        await this.skillsMutationService.applyUpsert({
          scope: 'user',
          rootKind: target.rootKind,
          folderName: skill.slug,
          files,
          reviewPlanId: preview.planId,
        });
        installedTo.push(target.label);
      } catch (error) {
        failures.push(`${target.label}: ${error instanceof Error ? error.message : String(error)}`);
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
