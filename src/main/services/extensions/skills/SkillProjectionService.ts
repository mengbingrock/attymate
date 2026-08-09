import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { atomicWriteAsync } from '@main/utils/atomicWrite';
import { getSkillsBasePath } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';

import { SkillRootsResolver } from './SkillRootsResolver';

import type {
  SkillProjectionOutcome,
  SkillProjectionResult,
  SkillRootKind,
} from '@shared/types/extensions';

const logger = createLogger('Service:SkillProjection');

/**
 * Marker written beside a COPIED pointer (win32, where symlinks need
 * elevation). Symlinked pointers need no marker: the link target itself proves
 * ownership.
 */
const COPY_MARKER_FILE = '.agent-teams-projection.json';

interface CopyMarker {
  canonicalDir: string;
  projectedAt: string;
}

interface ProjectionRecord {
  slug: string;
  canonicalDir: string;
  linkPath: string;
  rootKind: SkillRootKind;
  /** 'link' pointers are removed on release; 'copy' pointers use the marker. */
  kind: 'link' | 'copy';
}

interface ProjectionsFile {
  version: 1;
  projections: ProjectionRecord[];
}

export interface SkillProjectionOptions {
  /**
   * A running team's current project. Team-owned skills are projected here so
   * project precedence selects the right team's copy and concurrent teams in
   * different projects do not compete for one user-wide slug.
   */
  projectPath?: string;
}

/**
 * Points runtime-branded skill directories at the app's canonical store.
 *
 * The CLIs only discover skills inside their own folders and offer no setting
 * for extra search paths, so a canonical store outside them would be invisible.
 * Claude Code documents symlinked skill folders as supported (it follows the
 * link, reads SKILL.md from the target, and live-reloads through it), so the
 * app keeps one real copy and installs pointers.
 *
 * Ownership rules follow the MCP config lease in TeamMcpConfigBuilder: never
 * overwrite something we did not create, and on release only remove a pointer
 * that still points where we put it.
 */
export class SkillProjectionService {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly rootsResolver = new SkillRootsResolver(),
    private readonly skillsBasePath: string = getSkillsBasePath()
  ) {}

  private get projectionsFilePath(): string {
    return path.join(this.skillsBasePath, 'projections.json');
  }

  /**
   * Make `canonicalDir` discoverable as `<slug>`. Library skills project into
   * user roots; a running team's skills pass `projectPath` and project into
   * that launch folder instead. Idempotent.
   */
  async project(
    canonicalDir: string,
    slug: string,
    options?: SkillProjectionOptions
  ): Promise<SkillProjectionResult> {
    const projectPath = options?.projectPath?.trim();
    const targets = projectPath
      ? this.rootsResolver.resolve(projectPath).filter((root) => root.scope === 'project')
      : this.rootsResolver.resolveUserProjectionRoots();
    const results: SkillProjectionResult['targets'] = [];
    const records: ProjectionRecord[] = [];

    for (const target of targets) {
      const linkPath = path.join(target.rootPath, slug);
      const { outcome, message, kind } = await this.projectOne(
        canonicalDir,
        target.rootPath,
        linkPath
      );
      results.push({ linkPath, outcome, ...(message ? { message } : {}) });
      if (kind) {
        records.push({ slug, canonicalDir, linkPath, rootKind: target.rootKind, kind });
      }
    }

    if (records.length > 0) {
      await this.recordProjections(records);
    }

    return { slug, canonicalDir, targets: results };
  }

  private async projectOne(
    canonicalDir: string,
    rootPath: string,
    linkPath: string
  ): Promise<{ outcome: SkillProjectionOutcome; message?: string; kind?: 'link' | 'copy' }> {
    try {
      await fs.mkdir(rootPath, { recursive: true });

      const existing = await this.inspectExisting(linkPath, canonicalDir);
      if (existing === 'ours') return { outcome: 'already-linked', kind: 'link' };
      if (existing === 'ours-copy') {
        // Windows projections are copies, not live links. Refresh an owned
        // copy so edits to the canonical skill reach the runtime and stale
        // files removed from the canonical skill do not linger.
        await fs.rm(linkPath, { recursive: true, force: true });
        await this.installCopy(canonicalDir, linkPath);
        return { outcome: 'copied', kind: 'copy' };
      }
      if (existing === 'foreign') {
        // A hand-made skill, or another team's pointer, already owns this slug.
        return {
          outcome: 'skipped-existing',
          message: `${linkPath} already exists and was not created by the app`,
        };
      }

      if (process.platform === 'win32') {
        await this.installCopy(canonicalDir, linkPath);
        return { outcome: 'copied', kind: 'copy' };
      }

      await fs.symlink(canonicalDir, linkPath, 'dir');
      return { outcome: 'linked', kind: 'link' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Skill projection to ${linkPath} failed: ${message}`);
      return { outcome: 'failed', message };
    }
  }

  /**
   * Classify what already sits at `linkPath`: our pointer to this exact
   * canonical dir, our stale copy, someone else's entry, or nothing.
   */
  private async inspectExisting(
    linkPath: string,
    canonicalDir: string
  ): Promise<'absent' | 'ours' | 'ours-copy' | 'foreign'> {
    let stat;
    try {
      stat = await fs.lstat(linkPath);
    } catch {
      return 'absent';
    }

    if (stat.isSymbolicLink()) {
      try {
        const target = await fs.readlink(linkPath);
        const resolved = path.resolve(path.dirname(linkPath), target);
        return path.resolve(canonicalDir) === resolved ? 'ours' : 'foreign';
      } catch {
        return 'foreign';
      }
    }

    if (stat.isDirectory()) {
      try {
        const raw = await fs.readFile(path.join(linkPath, COPY_MARKER_FILE), 'utf8');
        const marker = JSON.parse(raw) as CopyMarker;
        return path.resolve(marker.canonicalDir) === path.resolve(canonicalDir)
          ? 'ours-copy'
          : 'foreign';
      } catch {
        return 'foreign';
      }
    }

    return 'foreign';
  }

  /**
   * Remove the pointers for `slug`, but only those we installed and only while
   * they still point at the canonical dir we recorded.
   */
  async release(slug: string, canonicalDir: string): Promise<void> {
    const file = await this.readProjections();
    const mine = file.projections.filter(
      (record) =>
        record.slug === slug && path.resolve(record.canonicalDir) === path.resolve(canonicalDir)
    );
    if (mine.length === 0) return;

    await this.releaseRecords(mine);
  }

  private async releaseRecords(records: readonly ProjectionRecord[]): Promise<void> {
    const recordKeys = new Set(
      records.map(
        (record) => `${path.resolve(record.canonicalDir)}\0${path.resolve(record.linkPath)}`
      )
    );
    for (const record of records) {
      const state = await this.inspectExisting(record.linkPath, record.canonicalDir);
      if (state !== 'ours' && state !== 'ours-copy') {
        logger.warn(
          `Skill pointer ${record.linkPath} changed since it was created; leaving it in place`
        );
        continue;
      }
      try {
        await fs.rm(record.linkPath, { recursive: true, force: true });
      } catch (error) {
        logger.warn(`Failed to remove skill pointer ${record.linkPath}: ${String(error)}`);
      }
    }

    await this.forgetProjections((record) => {
      const key = `${path.resolve(record.canonicalDir)}\0${path.resolve(record.linkPath)}`;
      return !recordKeys.has(key);
    });
  }

  /**
   * Release every pointer whose canonical dir is under `canonicalRoot`.
   * When a project is supplied, only that launch folder is reclaimed; this
   * prevents an old run's cleanup from touching another project's live team.
   */
  async releaseUnder(canonicalRoot: string, options?: SkillProjectionOptions): Promise<void> {
    const file = await this.readProjections();
    const root = path.resolve(canonicalRoot) + path.sep;
    const projectPath = options?.projectPath?.trim();
    const projectionRoots = projectPath
      ? this.rootsResolver
          .resolve(projectPath)
          .filter((resolvedRoot) => resolvedRoot.scope === 'project')
          .map((resolvedRoot) => path.resolve(resolvedRoot.rootPath))
      : null;
    const matches = file.projections.filter((record) => {
      const linkPath = path.resolve(record.linkPath);
      const belongsToProject =
        projectionRoots === null ||
        projectionRoots.some((projectionRoot) => {
          const relative = path.relative(projectionRoot, linkPath);
          return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
        });
      return belongsToProject && path.resolve(record.canonicalDir).startsWith(root);
    });
    if (matches.length > 0) await this.releaseRecords(matches);
  }

  private async copyTree(sourceDir: string, targetDir: string): Promise<void> {
    await fs.cp(sourceDir, targetDir, { recursive: true });
  }

  private async installCopy(canonicalDir: string, linkPath: string): Promise<void> {
    await this.copyTree(canonicalDir, linkPath);
    await atomicWriteAsync(
      path.join(linkPath, COPY_MARKER_FILE),
      `${JSON.stringify({ canonicalDir, projectedAt: new Date().toISOString() } satisfies CopyMarker, null, 2)}\n`
    );
  }

  private async readProjections(): Promise<ProjectionsFile> {
    try {
      const raw = await fs.readFile(this.projectionsFilePath, 'utf8');
      const parsed = JSON.parse(raw) as ProjectionsFile;
      if (!parsed || !Array.isArray(parsed.projections)) return { version: 1, projections: [] };
      return parsed;
    } catch {
      // Absent or corrupt is the same as empty; the next write replaces it.
      return { version: 1, projections: [] };
    }
  }

  /** Serializes read-modify-write so concurrent projections cannot lose records. */
  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private recordProjections(records: ProjectionRecord[]): Promise<void> {
    return this.enqueueWrite(async () => {
      const file = await this.readProjections();
      const kept = file.projections.filter(
        (existing) => !records.some((record) => record.linkPath === existing.linkPath)
      );
      await this.writeProjections({ version: 1, projections: [...kept, ...records] });
    });
  }

  private forgetProjections(keep: (record: ProjectionRecord) => boolean): Promise<void> {
    return this.enqueueWrite(async () => {
      const file = await this.readProjections();
      await this.writeProjections({ version: 1, projections: file.projections.filter(keep) });
    });
  }

  private async writeProjections(file: ProjectionsFile): Promise<void> {
    await fs.mkdir(path.dirname(this.projectionsFilePath), { recursive: true });
    await atomicWriteAsync(this.projectionsFilePath, `${JSON.stringify(file, null, 2)}\n`);
  }
}
