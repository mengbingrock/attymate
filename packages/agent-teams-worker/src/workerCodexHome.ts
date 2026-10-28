import { chmod, lstat, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, parse, resolve } from 'node:path';

export interface PreparedWorkerCodexHome {
  readonly codexHome: string;
  readonly env: NodeJS.ProcessEnv;
}

export const resolveWorkerCodexHomePath = (dataDir: string, codexHome?: string): string =>
  resolve(codexHome ?? join(dataDir, 'codex-home'));

export const prepareWorkerCodexHome = async (options: {
  readonly dataDir: string;
  readonly codexHome?: string;
  readonly processEnv?: NodeJS.ProcessEnv;
  readonly reuseExistingLogin?: boolean;
}): Promise<PreparedWorkerCodexHome> => {
  const processEnv = options.processEnv ?? process.env;
  const codexHome = resolveWorkerCodexHomePath(
    options.dataDir,
    options.codexHome ??
      (options.reuseExistingLogin
        ? processEnv.CODEX_HOME?.trim() || join(homedir(), '.codex')
        : undefined)
  );
  if (codexHome === parse(codexHome).root) {
    throw new Error('Worker Codex home must not be a filesystem root');
  }

  let created = false;
  try {
    await lstat(codexHome);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    created = true;
  }

  const stat = await lstat(codexHome);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(
      `Worker Codex home must be a directory, not a file or symbolic link: ${codexHome}`
    );
  }
  if (process.platform !== 'win32') {
    if (created) {
      await chmod(codexHome, 0o700);
    } else if ((stat.mode & 0o077) !== 0) {
      throw new Error(`Existing Worker Codex home must be private (mode 0700): ${codexHome}`);
    }
  }

  return {
    codexHome,
    env: { ...processEnv, CODEX_HOME: codexHome },
  };
};
