import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { parseTeamImportFrontmatter } from '@features/team-import/core';
import { SkillsCatalogService } from '@main/services/extensions/skills/SkillsCatalogService';
import { SkillStore } from '@main/services/extensions/skills/SkillStore';
import { createLogger } from '@shared/utils/logger';

import type { TeamExportSkillSourcePort } from '../../core/application/ports/TeamExportPorts';
import type { TeamImportBundleSkill } from '@features/team-import/contracts';
import type { SkillStoreFile } from '@main/services/extensions/skills/SkillStore';

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

/** Applies the bundle's carryability rules to files read from the store. */
function carryableStoreFiles(files: readonly SkillStoreFile[]): SkillStoreFile[] {
  return files
    .filter(
      (file) =>
        isCarryablePath(file.relativePath) && Buffer.byteLength(file.content) <= MAX_FILE_BYTES
    )
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .slice(0, MAX_FILES_PER_SKILL);
}

/**
 * Resolves a skill slug to its files, in the order that says who owns it: the
 * exporting team's own store first, then the shared library, then whatever the
 * catalog can still find (a legacy project folder, or the user-wide roots).
 * Two teams may legitimately own a same-named skill, so the team copy always
 * wins.
 */
export class TeamExportSkillSource implements TeamExportSkillSourcePort {
  private projectPath: string | null = null;
  private teamName: string | null = null;

  constructor(
    private readonly catalog = new SkillsCatalogService(),
    private readonly store = new SkillStore()
  ) {}

  /** Scopes subsequent lookups to one team's project folder. */
  setProjectPath(projectPath: string | null): void {
    this.projectPath = projectPath?.trim() ? projectPath.trim() : null;
  }

  /** Scopes subsequent lookups to one team's skill store. */
  setTeamName(teamName: string | null): void {
    this.teamName = teamName?.trim() ? teamName.trim() : null;
  }

  /** Slugs the team owns in the app's skill store. */
  async listTeamSlugs(teamName: string): Promise<string[]> {
    try {
      return await this.store.listTeamSlugs(teamName);
    } catch (error) {
      logger.warn(`Failed to list store skills for team ${teamName}`, error);
      return [];
    }
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
    return (await this.resolveFromStore(slug)) ?? (await this.resolveFromCatalog(slug));
  }

  /** The app's own store: the team's copy first, then the shared library. */
  private async resolveFromStore(slug: string): Promise<TeamImportBundleSkill | null> {
    let dirs: string[];
    try {
      dirs = [
        ...(this.teamName ? [this.store.resolveTeamSkillDir(this.teamName, slug)] : []),
        this.store.resolveLibrarySkillDir(slug),
      ];
    } catch {
      // The store rejects unsafe slugs; the catalog lookup can still find one.
      return null;
    }
    for (const skillDir of dirs) {
      try {
        const files = carryableStoreFiles(await this.store.readSkillFiles(skillDir));
        const skillFile = files.find((file) => file.relativePath === 'SKILL.md');
        if (!skillFile) continue;
        return {
          slug,
          description: parseTeamImportFrontmatter(skillFile.content).description ?? '',
          files,
        };
      } catch (error) {
        logger.warn(`Failed to read skill "${slug}" from ${skillDir}`, error);
      }
    }
    return null;
  }

  private async resolveFromCatalog(slug: string): Promise<TeamImportBundleSkill | null> {
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
