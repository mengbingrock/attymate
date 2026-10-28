import { randomUUID } from 'node:crypto';
import {
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

interface Owner {
  pid: number;
  token: string;
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** Publish complete contents exclusively; a crash can leave only an unreferenced temporary. */
export const publishLockFile = (path: string, content: string): boolean => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    try {
      linkSync(temporary, path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // A private temporary never controls ownership; recovery can ignore it.
    }
  }
};

const ownerFrom = (content: string): Owner => {
  let owner: Owner;
  try {
    owner = JSON.parse(content) as Owner;
  } catch {
    throw new Error('Process lock is incomplete; another process may be starting');
  }
  if (
    !owner ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid < 1 ||
    typeof owner.token !== 'string' ||
    !owner.token
  )
    throw new Error('Invalid process lock identity');
  return owner;
};

const dead = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    // EPERM is evidence of a live process, not permission to reclaim its files.
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw error;
  }
};

/**
 * Immutable generations avoid an unrecoverable empty guard and the unlink/recreate
 * race in stale-guard recovery. Never delete these records while a lock may be used.
 * Legacy .reclaim files are obsolete and deliberately do not control this protocol.
 */
export const withLockReclamation = (path: string, operation: () => void): boolean => {
  const directory = `${path}.reclaims`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid lock journal');
  while (true) {
    const records = readdirSync(directory)
      .filter((name) => /^\d{16}\.json$/.test(name))
      .sort();
    const latest = records.at(-1);
    let generation = 1;
    if (latest) {
      const previous = join(directory, latest);
      const owner = ownerFrom(readFileSync(previous, 'utf8'));
      let completed = false;
      try {
        completed = readFileSync(`${previous}.done`, 'utf8') === owner.token;
        if (!completed) throw new Error('Invalid lock journal completion');
      } catch (error) {
        if (!missing(error)) throw error;
      }
      if (!completed && !dead(owner.pid)) return false;
      generation = Number(latest.slice(0, 16)) + 1;
      if (!Number.isSafeInteger(generation)) throw new Error('Lock journal exhausted');
    }
    const record = join(directory, `${String(generation).padStart(16, '0')}.json`);
    const token = randomUUID();
    if (!publishLockFile(record, JSON.stringify({ pid: process.pid, token }))) continue;
    try {
      operation();
    } finally {
      publishLockFile(`${record}.done`, token);
    }
    return true;
  }
};

export const reclaimProcessLock = (path: string): { pid: number } | undefined => {
  let liveOwner: Owner | undefined;
  withLockReclamation(path, () => {
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid process lock file');
      const content = readFileSync(path, 'utf8');
      const owner = ownerFrom(content);
      if (!dead(owner.pid)) {
        liveOwner = owner;
        return;
      }
      const current = lstatSync(path);
      if (
        current.dev === stat.dev &&
        current.ino === stat.ino &&
        readFileSync(path, 'utf8') === content
      )
        unlinkSync(path);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  });
  return liveOwner;
};
