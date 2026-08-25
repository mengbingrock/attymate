// @vitest-environment node

import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorkspaceFileBroker } from '@claude-teams/agent-teams-worker';
import { describe, expect, it } from 'vitest';

describe('WorkspaceFileBroker', () => {
  it('lists, reads, and atomically writes only regular files contained by the workspace', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-workspace-broker-'));
    const workspace = join(dataRoot, 'workspace');
    const outside = join(dataRoot, 'outside.txt');
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(join(workspace, 'src', 'index.ts'), 'export const value = 1;\n', 'utf8');
    await writeFile(outside, 'secret\n', 'utf8');
    await symlink(outside, join(workspace, 'outside-link'));
    const broker = new WorkspaceFileBroker(workspace);

    await expect(broker.list('src')).resolves.toMatchObject({
      path: 'src',
      entries: [{ name: 'index.ts', path: 'src/index.ts', type: 'file' }],
    });
    const opened = await broker.read('src/index.ts');
    expect(opened).toMatchObject({ path: 'src/index.ts', content: 'export const value = 1;\n' });

    await expect(
      broker.write('src/index.ts', 'export const value = 2;\n', opened.revision)
    ).resolves.toMatchObject({ content: 'export const value = 2;\n' });
    await expect(readFile(join(workspace, 'src', 'index.ts'), 'utf8')).resolves.toBe(
      'export const value = 2;\n'
    );
    await expect(broker.write('src/index.ts', 'stale', opened.revision)).rejects.toMatchObject({
      code: 'WORKSPACE_FILE_REVISION_CONFLICT',
    });
    await expect(broker.read('../outside.txt')).rejects.toThrow('outside the assigned workspace');
    await expect(broker.read('outside-link')).rejects.toThrow('symbolic links');
  });
});
