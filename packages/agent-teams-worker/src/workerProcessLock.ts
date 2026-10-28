import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { publishLockFile, reclaimProcessLock } from './processLockFile';

/** Prevent two CLI processes from adopting the same durable Worker identity. */
export const acquireWorkerProcessLock = async (dataDir: string): Promise<() => void> => {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, 'worker-process.lock');
  const content = JSON.stringify({ pid: process.pid, token: randomUUID() });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (publishLockFile(path, content)) {
      return () => {
        try {
          if (readFileSync(path, 'utf8') === content) unlinkSync(path);
        } catch {
          /* Already removed, replaced, or no longer owned. */
        }
      };
    }
    const owner = reclaimProcessLock(path);
    if (owner) throw new Error(`Worker data directory is already in use by process ${owner.pid}`);
  }
  throw new Error(
    'Worker data directory was claimed concurrently; retry after checking its process'
  );
};
