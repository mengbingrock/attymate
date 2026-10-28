import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { publishLockFile, reclaimProcessLock } from './processLockFile';

export const readCodexConfig = async (configPath: string): Promise<string> => {
  try {
    const stat = await lstat(configPath);
    if (stat.isSymbolicLink())
      throw new Error(`Refusing to replace symlinked Codex config: ${configPath}`);
    if (!stat.isFile()) throw new Error(`Codex config path is not a file: ${configPath}`);
    return await readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
};

/** OS-level exclusive creation also serializes separate installer processes. */
export const withCodexConfigLock = async <T>(
  configPath: string,
  operation: () => Promise<T>
): Promise<T> => {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  const canonicalPath = join(await realpath(dirname(configPath)), basename(configPath));
  const lockPath = `${canonicalPath}.agent-teams.lock`;
  const token = randomUUID();
  const deadline = Date.now() + 5_000;
  while (true) {
    if (publishLockFile(lockPath, JSON.stringify({ pid: process.pid, token }))) break;
    reclaimProcessLock(lockPath);
    if (Date.now() >= deadline) throw new Error(`Codex MCP config is locked: ${lockPath}`);
    await new Promise((done) => setTimeout(done, 20));
  }
  try {
    return await operation();
  } finally {
    const lock = await readFile(lockPath, 'utf8').catch(() => '');
    if (lock === JSON.stringify({ pid: process.pid, token })) await unlink(lockPath);
  }
};

export const writeCodexConfigAtomically = async (
  configPath: string,
  previous: string,
  content: string
) => {
  parseToml(content);
  let mode = 0o600;
  try {
    mode = (await lstat(configPath)).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporaryPath = `${configPath}.agent-teams-${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', mode, flag: 'wx' });
    await chmod(temporaryPath, mode);
    if ((await readCodexConfig(configPath)) !== previous) {
      throw new Error(
        'Codex config changed outside this installer; retry after reviewing the edit'
      );
    }
    await rename(temporaryPath, configPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
};
