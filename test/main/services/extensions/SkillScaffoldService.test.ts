import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { SkillRootsResolver } from '@main/services/extensions/skills/SkillRootsResolver';
import { SkillScaffoldService } from '@main/services/extensions/skills/SkillScaffoldService';
import { setAppDataBasePath } from '@main/utils/pathDecoder';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let appData: string;

beforeEach(async () => {
  appData = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-scaffold-'));
  setAppDataBasePath(appData);
});

afterEach(async () => {
  setAppDataBasePath(null);
  await fs.rm(appData, { recursive: true, force: true });
});

describe('SkillScaffoldService', () => {
  it('normalizes valid relative draft file paths', () => {
    const service = new SkillScaffoldService();

    const files = service.normalizeDraftFiles([
      { relativePath: 'scripts/../scripts/run.sh', content: 'echo hi' },
    ]);

    expect(files[0]?.relativePath).toBe('scripts/run.sh');
  });

  it('rejects path traversal in draft file paths', () => {
    const service = new SkillScaffoldService();

    expect(() =>
      service.normalizeDraftFiles([{ relativePath: '../escape.txt', content: 'nope' }])
    ).toThrow('Invalid relative path');
  });

  it('rejects existing skill ids outside the selected root', async () => {
    const resolver = new SkillRootsResolver();
    const service = new SkillScaffoldService(resolver);

    await expect(
      service.resolveUpsertTarget(
        'project',
        'claude',
        '/tmp/demo-project',
        'valid-name',
        '/tmp/another-project/.claude/skills/foreign'
      )
    ).rejects.toThrow('outside the allowed root');
  });

  it('refuses a team-scoped write that names no team', async () => {
    const service = new SkillScaffoldService(new SkillRootsResolver());

    await expect(
      service.resolveUpsertTarget('team', 'library', undefined, 'valid-name')
    ).rejects.toThrow('teamName is required for team-scoped skills');
  });

  it('targets the team root when a team is named', async () => {
    const service = new SkillScaffoldService(new SkillRootsResolver());

    const target = await service.resolveUpsertTarget(
      'team',
      'library',
      undefined,
      'valid-name',
      undefined,
      'signal-ops'
    );

    expect(target).toBe(path.join(appData, 'skills', 'teams', 'signal-ops', 'valid-name'));
  });
});
