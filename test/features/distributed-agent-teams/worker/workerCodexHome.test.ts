// @vitest-environment node

import { chmod, lstat, mkdir, mkdtemp, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareWorkerCodexHome } from '@claude-teams/agent-teams-worker';
import { describe, expect, it } from 'vitest';

describe('prepareWorkerCodexHome', () => {
  it('creates a private empty Codex home under Worker data without copying credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-teams-worker-codex-home-'));
    const dataDir = join(root, 'worker');

    const prepared = await prepareWorkerCodexHome({
      dataDir,
      processEnv: { PATH: '/usr/bin', CODEX_HOME: '/global/codex-home' },
    });

    expect(prepared.codexHome).toBe(join(dataDir, 'codex-home'));
    expect(prepared.env).toMatchObject({
      PATH: '/usr/bin',
      CODEX_HOME: join(dataDir, 'codex-home'),
    });
    expect(await readdir(prepared.codexHome)).toEqual([]);
    if (process.platform !== 'win32') {
      expect((await lstat(prepared.codexHome)).mode & 0o777).toBe(0o700);
    }
  });

  it('rejects a Codex home path that is a file instead of a private directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-teams-worker-codex-home-file-'));
    const invalidHome = join(root, 'not-a-directory');
    await writeFile(invalidHome, 'do not overwrite', 'utf8');

    await expect(
      prepareWorkerCodexHome({ dataDir: join(root, 'worker'), codexHome: invalidHome })
    ).rejects.toThrow('must be a directory');
  });

  it.runIf(process.platform !== 'win32')(
    'rejects symbolic links and existing directories that other users can access',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'agent-teams-worker-codex-home-policy-'));
      const sharedHome = join(root, 'shared-home');
      const linkedHome = join(root, 'linked-home');
      await mkdir(sharedHome, { mode: 0o755 });
      await chmod(sharedHome, 0o755);
      await symlink(sharedHome, linkedHome);

      await expect(
        prepareWorkerCodexHome({ dataDir: join(root, 'worker'), codexHome: linkedHome })
      ).rejects.toThrow('symbolic link');
      await expect(
        prepareWorkerCodexHome({ dataDir: join(root, 'worker'), codexHome: sharedHome })
      ).rejects.toThrow('mode 0700');
    }
  );
});
