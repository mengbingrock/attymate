import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { getHomeDir } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';

import { MATTER_SKILL_MARKDOWN, MATTER_SKILL_SLUG } from '../../core/domain/matterSkillDefinition';

import type { SkillsMutationService } from '@main/services/extensions/skills/SkillsMutationService';

const logger = createLogger('Feature:Matter:SkillSeeder');

const SKILL_FILE = 'SKILL.md';

interface SeedTarget {
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
 * Seeds the matter dashboard workflow as an ordinary user skill the first time
 * it is missing, then leaves it alone forever.
 *
 * Same targets and same skip-never-overwrite policy as imported team skills
 * (`SkillsMutationInstaller`): stock Claude reads ~/.claude/skills and stock
 * Codex reads ~/.codex/skills, and a team's provider is chosen later. The user
 * owns the file once it exists — edits, renames, and additions all survive, and
 * `MatterRefreshCoordinator` reads the on-disk copy rather than this constant.
 */
export class MatterSkillSeeder {
  constructor(
    private readonly skillsMutationService: SkillsMutationService,
    private readonly homeDir: string = getHomeDir()
  ) {}

  private async getTargets(): Promise<SeedTarget[]> {
    const targets: SeedTarget[] = [
      {
        rootKind: 'claude',
        rootPath: path.join(this.homeDir, '.claude', 'skills'),
        label: '~/.claude/skills',
      },
    ];
    if (await directoryExists(path.join(this.homeDir, '.codex'))) {
      targets.push({
        rootKind: 'codex',
        rootPath: path.join(this.homeDir, '.codex', 'skills'),
        label: '~/.codex/skills',
      });
    }
    return targets;
  }

  /** Absolute path of the seeded skill file in the primary (Claude) root. */
  getPrimarySkillFilePath(): string {
    return path.join(this.homeDir, '.claude', 'skills', MATTER_SKILL_SLUG, SKILL_FILE);
  }

  /** The user's copy of the skill body, or null when it is absent/unreadable. */
  async readInstalledMarkdown(): Promise<string | null> {
    try {
      const content = await fs.readFile(this.getPrimarySkillFilePath(), 'utf8');
      return content.trim() ? content : null;
    } catch {
      return null;
    }
  }

  private async slugExists(rootPath: string): Promise<boolean> {
    try {
      const entries = await fs.readdir(rootPath, { withFileTypes: true });
      return entries.some(
        (entry) => entry.isDirectory() && entry.name.toLowerCase() === MATTER_SKILL_SLUG
      );
    } catch {
      return false;
    }
  }

  /** Idempotent: writes the skill only into roots that do not already have it. */
  async seed(): Promise<void> {
    const files = [{ relativePath: SKILL_FILE, content: MATTER_SKILL_MARKDOWN }];
    for (const target of await this.getTargets()) {
      if (await this.slugExists(target.rootPath)) continue;
      try {
        const preview = await this.skillsMutationService.previewUpsert({
          scope: 'user',
          rootKind: target.rootKind,
          folderName: MATTER_SKILL_SLUG,
          files,
        });
        await this.skillsMutationService.applyUpsert({
          scope: 'user',
          rootKind: target.rootKind,
          folderName: MATTER_SKILL_SLUG,
          files,
          reviewPlanId: preview.planId,
        });
        logger.info(`Seeded the ${MATTER_SKILL_SLUG} skill into ${target.label}`);
      } catch (error) {
        // Non-fatal: the refresh path falls back to the bundled markdown.
        logger.warn(`Could not seed the ${MATTER_SKILL_SLUG} skill into ${target.label}`, error);
      }
    }
  }
}
