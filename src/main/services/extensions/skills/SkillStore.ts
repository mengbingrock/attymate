import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { atomicWriteAsync } from '@main/utils/atomicWrite';

import { getLibrarySkillsRootPath, getTeamSkillsRootPath } from './SkillRootsResolver';

export interface SkillStoreFile {
  relativePath: string;
  content: string;
}

/** Rejects traversal, absolute paths and dotfiles, like the import bundle sanitizer. */
function assertSafeSkillStoreSegment(kind: string, segment: string): void {
  if (
    !segment ||
    segment === '.' ||
    segment === '..' ||
    segment.startsWith('.') ||
    path.isAbsolute(segment) ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.includes('\0')
  ) {
    throw new Error(`Invalid ${kind} name: ${JSON.stringify(segment)}`);
  }
}

function assertSafeRelativePath(relativePath: string): void {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Skill file path must be relative: ${relativePath}`);
  }
  for (const segment of relativePath.split(/[\\/]+/)) {
    if (segment === '') continue;
    assertSafeSkillStoreSegment('skill file', segment);
  }
}

/**
 * The app's canonical skill store: `<userData>/skills/library/<slug>` for
 * machine-wide skills and `<userData>/skills/teams/<team>/<slug>` for skills a
 * team owns, edits and exports. Model-agnostic by construction — no runtime
 * name appears in the path. The runtime-branded folders receive pointers from
 * SkillProjectionService.
 */
export class SkillStore {
  resolveLibrarySkillDir(slug: string): string {
    assertSafeSkillStoreSegment('skill', slug);
    return path.join(getLibrarySkillsRootPath(), slug);
  }

  resolveTeamSkillsDir(teamName: string): string {
    assertSafeSkillStoreSegment('team', teamName);
    return getTeamSkillsRootPath(teamName);
  }

  resolveTeamSkillDir(teamName: string, slug: string): string {
    assertSafeSkillStoreSegment('skill', slug);
    return path.join(this.resolveTeamSkillsDir(teamName), slug);
  }

  resolveSkillFilePath(skillDir: string): string {
    return path.join(skillDir, 'SKILL.md');
  }

  async listSlugs(skillsDir: string): Promise<string[]> {
    let entries;
    try {
      entries = await fs.readdir(skillsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const slugs: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (await this.hasSkillFile(path.join(skillsDir, entry.name))) {
        slugs.push(entry.name);
      }
    }
    return slugs.sort((a, b) => a.localeCompare(b));
  }

  listTeamSlugs(teamName: string): Promise<string[]> {
    return this.listSlugs(this.resolveTeamSkillsDir(teamName));
  }

  async readSkillMarkdown(skillDir: string): Promise<string | null> {
    try {
      const content = await fs.readFile(this.resolveSkillFilePath(skillDir), 'utf8');
      return content.trim() ? content : null;
    } catch {
      return null;
    }
  }

  /** Every file of a skill, for export bundles. */
  async readSkillFiles(skillDir: string, prefix = ''): Promise<SkillStoreFile[]> {
    let entries;
    try {
      entries = await fs.readdir(skillDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const collected: SkillStoreFile[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absolute = path.join(skillDir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        collected.push(...(await this.readSkillFiles(absolute, relativePath)));
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        collected.push({ relativePath, content: await fs.readFile(absolute, 'utf8') });
      } catch {
        // Unreadable or binary files are skipped; the store carries text skills.
      }
    }
    return collected;
  }

  /**
   * Writes a skill's files. Existing skills are left untouched unless
   * `overwrite` is set, so a team never silently loses local edits.
   */
  async writeSkill(
    skillDir: string,
    files: readonly SkillStoreFile[],
    options?: { overwrite?: boolean }
  ): Promise<'installed' | 'skipped'> {
    if (!options?.overwrite && (await this.hasSkillFile(skillDir))) {
      return 'skipped';
    }
    for (const file of files) {
      assertSafeRelativePath(file.relativePath);
    }
    await fs.mkdir(skillDir, { recursive: true });
    for (const file of files) {
      const target = path.join(skillDir, file.relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await atomicWriteAsync(target, file.content);
    }
    return 'installed';
  }

  async removeTeam(teamName: string): Promise<void> {
    await fs.rm(this.resolveTeamSkillsDir(teamName), { recursive: true, force: true });
  }

  private async hasSkillFile(skillDir: string): Promise<boolean> {
    for (const candidate of ['SKILL.md', 'Skill.md', 'skill.md']) {
      try {
        const stat = await fs.stat(path.join(skillDir, candidate));
        if (stat.isFile()) return true;
      } catch {
        // try next candidate
      }
    }
    return false;
  }
}
