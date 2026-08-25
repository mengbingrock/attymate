import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 1_000;

export interface WorkspaceFileEntry {
  readonly name: string;
  readonly path: string;
  readonly type: 'file' | 'directory';
  readonly size: number;
  readonly modifiedAt: string;
}

export interface WorkspaceDirectoryListing {
  readonly path: string;
  readonly entries: readonly WorkspaceFileEntry[];
}

export interface WorkspaceTextFile {
  readonly path: string;
  readonly content: string;
  readonly revision: string;
  readonly size: number;
  readonly modifiedAt: string;
}

export class WorkspaceFileRevisionConflictError extends Error {
  readonly code = 'WORKSPACE_FILE_REVISION_CONFLICT';

  constructor() {
    super('Workspace file changed since it was opened');
    this.name = 'WorkspaceFileRevisionConflictError';
  }
}

const isContained = (root: string, candidate: string): boolean => {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..');
};

const displayPath = (root: string, candidate: string): string =>
  relative(root, candidate).split(sep).join('/');

const revisionFor = (content: Buffer): string =>
  createHash('sha256').update(content).digest('hex');

export class WorkspaceFileBroker {
  constructor(private readonly workspaceRoot: string) {}

  async list(pathInput: string): Promise<WorkspaceDirectoryListing> {
    const { root, target } = await this.resolveExisting(pathInput);
    const targetStat = await lstat(target);
    if (targetStat.isSymbolicLink()) throw new Error('Workspace paths cannot traverse symbolic links');
    if (!targetStat.isDirectory()) throw new TypeError('Workspace path is not a directory');
    const entries = await readdir(target, { withFileTypes: true });
    const projected: WorkspaceFileEntry[] = [];
    for (const entry of entries.slice(0, MAX_DIRECTORY_ENTRIES)) {
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue;
      const entryPath = resolve(target, entry.name);
      const entryRealPath = await realpath(entryPath);
      if (!isContained(root, entryRealPath)) continue;
      const entryStat = await stat(entryRealPath);
      projected.push({
        name: entry.name,
        path: displayPath(root, entryRealPath),
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entryStat.size,
        modifiedAt: entryStat.mtime.toISOString(),
      });
    }
    projected.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    return { path: displayPath(root, target), entries: projected };
  }

  async read(pathInput: string): Promise<WorkspaceTextFile> {
    const { root, target } = await this.resolveExisting(pathInput);
    const targetStat = await lstat(target);
    if (targetStat.isSymbolicLink()) throw new Error('Workspace paths cannot traverse symbolic links');
    if (!targetStat.isFile()) throw new TypeError('Workspace path is not a regular file');
    if (targetStat.size > MAX_FILE_BYTES) throw new Error('Workspace file exceeds the size limit');
    const content = await readFile(target);
    if (content.includes(0)) throw new Error('Binary workspace files cannot be opened as text');
    return {
      path: displayPath(root, target),
      content: content.toString('utf8'),
      revision: revisionFor(content),
      size: content.length,
      modifiedAt: targetStat.mtime.toISOString(),
    };
  }

  async write(
    pathInput: string,
    content: string,
    expectedRevision?: string
  ): Promise<WorkspaceTextFile> {
    const encoded = Buffer.from(content, 'utf8');
    if (encoded.length > MAX_FILE_BYTES) throw new Error('Workspace file exceeds the size limit');
    const root = await realpath(this.workspaceRoot);
    const target = this.resolveLexically(root, pathInput);
    const parent = await realpath(dirname(target));
    if (!isContained(root, parent)) throw new Error('Workspace path is outside the assigned workspace');
    let exists = true;
    try {
      const targetStat = await lstat(target);
      if (targetStat.isSymbolicLink()) {
        throw new Error('Workspace paths cannot traverse symbolic links');
      }
      if (!targetStat.isFile()) throw new TypeError('Workspace path is not a regular file');
      const targetRealPath = await realpath(target);
      if (!isContained(root, targetRealPath)) {
        throw new Error('Workspace path is outside the assigned workspace');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') exists = false;
      else throw error;
    }
    if (expectedRevision !== undefined) {
      if (!exists) throw new WorkspaceFileRevisionConflictError();
      const current = await readFile(target);
      if (revisionFor(current) !== expectedRevision) throw new WorkspaceFileRevisionConflictError();
    }
    const temporaryPath = resolve(parent, `.agent-teams-write-${randomUUID()}`);
    try {
      await writeFile(temporaryPath, encoded, { flag: 'wx', mode: 0o600 });
      await rename(temporaryPath, target);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    return await this.read(displayPath(root, target));
  }

  private async resolveExisting(pathInput: string): Promise<{ root: string; target: string }> {
    const root = await realpath(this.workspaceRoot);
    const lexicalTarget = this.resolveLexically(root, pathInput);
    const lexicalStat = await lstat(lexicalTarget);
    if (lexicalStat.isSymbolicLink()) {
      throw new Error('Workspace paths cannot traverse symbolic links');
    }
    const target = await realpath(lexicalTarget);
    if (!isContained(root, target)) {
      throw new Error('Workspace path is outside the assigned workspace');
    }
    return { root, target };
  }

  private resolveLexically(root: string, pathInput: string): string {
    if (pathInput.includes('\0') || isAbsolute(pathInput)) {
      throw new Error('Workspace path is outside the assigned workspace');
    }
    const target = resolve(root, pathInput || '.');
    if (!isContained(root, target)) {
      throw new Error('Workspace path is outside the assigned workspace');
    }
    return target;
  }
}
