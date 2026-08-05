import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { SkillsCatalogService } from '@main/services/extensions/skills/SkillsCatalogService';
import { createLogger } from '@shared/utils/logger';

import type { TeamExportSkillSourcePort } from '../../core/application/ports/TeamExportPorts';
import type { TeamImportBundleSkill } from '@features/team-import/contracts';

const logger = createLogger('Feature:TeamExport:Skills');

/** The importer's per-skill ceilings; exporting past them loses files silently. */
const MAX_FILES_PER_SKILL = 30;
const MAX_FILE_BYTES = 64 * 1024;

/**
 * Segment rule the importer's `sanitizeBundleRelativePath` enforces: every
 * segment must start with a word character, so dotfiles inside a skill cannot
 * travel in a bundle.
 */
const SAFE_SEGMENT = /^\w[\w.\- ]*$/;

function isCarryablePath(relativePath: string): boolean {
  const segments = relativePath.split('/');
  return segments.every((segment) => SAFE_SEGMENT.test(segment) && !/[. ]$/.test(segment));
}

async function collectFiles(
  rootDir: string,
  currentDir: string,
  collected: { relativePath: string; content: string }[]
): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (collected.length >= MAX_FILES_PER_SKILL) return;
    const absolute = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolute).split(path.sep).join('/');
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await collectFiles(rootDir, absolute, collected);
      continue;
    }
    if (!entry.isFile() || !isCarryablePath(relativePath)) continue;
    const stat = await fs.stat(absolute);
    if (stat.size > MAX_FILE_BYTES) continue;
    collected.push({ relativePath, content: await fs.readFile(absolute, 'utf8') });
  }
}

/**
 * Resolves a skill slug to its files, preferring the team's own project skill
 * root over the user-wide library: a team's skills live with its project, and
 * two teams may legitimately own a same-named skill.
 */
export class TeamExportSkillSource implements TeamExportSkillSourcePort {
  private projectPath: string | null = null;

  constructor(private readonly catalog = new SkillsCatalogService()) {}

  /** Scopes subsequent lookups to one team's project folder. */
  setProjectPath(projectPath: string | null): void {
    this.projectPath = projectPath?.trim() ? projectPath.trim() : null;
  }

  /** Slugs the team owns in its project skill roots. */
  async listProjectSlugs(projectPath: string): Promise<string[]> {
    try {
      const items = await this.catalog.list(projectPath);
      return [
        ...new Set(items.filter((item) => item.scope === 'project').map((item) => item.folderName)),
      ].sort((left, right) => left.localeCompare(right));
    } catch (error) {
      logger.warn(`Failed to list project skills under ${projectPath}`, error);
      return [];
    }
  }

  async resolve(slug: string): Promise<TeamImportBundleSkill | null> {
    try {
      const items = await this.catalog.list(this.projectPath ?? undefined);
      const matches = items.filter(
        (item) =>
          item.folderName.toLowerCase() === slug.toLowerCase() ||
          item.name.toLowerCase() === slug.toLowerCase()
      );
      // The team's own copy wins over a same-named user-wide skill.
      const match = matches.find((item) => item.scope === 'project') ?? matches[0];
      if (!match) return null;

      const files: { relativePath: string; content: string }[] = [];
      await collectFiles(match.skillDir, match.skillDir, files);
      if (files.length === 0) return null;

      return {
        slug,
        description: match.description,
        files,
      };
    } catch (error) {
      logger.warn(`Failed to resolve skill "${slug}" for export`, error);
      return null;
    }
  }
}
