import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isMatterEffectivelyEmpty } from '@features/matter-dashboard/main';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

async function makeTeam(matterContents?: string): Promise<{ base: string; teamName: string }> {
  const base = await mkdtemp(path.join(tmpdir(), 'matter-scan-'));
  temporaryDirectories.push(base);
  const teamName = 'scan-team';
  await mkdir(path.join(base, teamName));
  if (matterContents !== undefined) {
    await writeFile(path.join(base, teamName, 'matter.json'), matterContents);
  }
  return { base, teamName };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('isMatterEffectivelyEmpty', () => {
  it('treats a missing matter file as empty', async () => {
    const { base, teamName } = await makeTeam();
    expect(await isMatterEffectivelyEmpty(base, teamName)).toBe(true);
  });

  it('treats the seeded schema marker as empty', async () => {
    const { base, teamName } = await makeTeam('{"schemaVersion":1}');
    expect(await isMatterEffectivelyEmpty(base, teamName)).toBe(true);
  });

  it('treats audit-only bookkeeping as empty', async () => {
    const { base, teamName } = await makeTeam(
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: '2026-08-01T00:00:00.000Z',
        updatedBy: 'team-lead',
        approvedBy: 'user',
      })
    );
    expect(await isMatterEffectivelyEmpty(base, teamName)).toBe(true);
  });

  it('treats real content sections as not empty', async () => {
    const { base, teamName } = await makeTeam(
      JSON.stringify({ schemaVersion: 1, caption: 'Smith v. Jones Trucking' })
    );
    expect(await isMatterEffectivelyEmpty(base, teamName)).toBe(false);
  });

  it('treats corrupt JSON as empty', async () => {
    const { base, teamName } = await makeTeam('{not json');
    expect(await isMatterEffectivelyEmpty(base, teamName)).toBe(true);
  });
});
