import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { initializeMatterFileIfMissing } from '@features/matter-dashboard/main';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

async function makeTeamsBase(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'matter-init-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('initializeMatterFileIfMissing', () => {
  it('seeds a schema-marker matter file for a new team', async () => {
    const base = await makeTeamsBase();
    await mkdir(path.join(base, 'fresh-team'));

    await initializeMatterFileIfMissing(base, 'fresh-team');

    const contents = JSON.parse(await readFile(path.join(base, 'fresh-team', 'matter.json'), 'utf8'));
    expect(contents).toEqual({ schemaVersion: 1 });
  });

  it('never clobbers an existing matter file', async () => {
    const base = await makeTeamsBase();
    await mkdir(path.join(base, 'existing-team'));
    const filePath = path.join(base, 'existing-team', 'matter.json');
    await writeFile(filePath, JSON.stringify({ schemaVersion: 1, caption: 'Real v. Case' }));

    await initializeMatterFileIfMissing(base, 'existing-team');

    const contents = JSON.parse(await readFile(filePath, 'utf8'));
    expect(contents.caption).toBe('Real v. Case');
  });
});
