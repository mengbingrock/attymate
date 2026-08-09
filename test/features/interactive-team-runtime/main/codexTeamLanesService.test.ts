// @vitest-environment node
/* eslint-disable sonarjs/publicly-writable-directories -- Test fixtures intentionally use temp paths. */

import {
  CodexTeamLanesService,
  type InteractiveRuntimeBinding,
} from '@features/interactive-team-runtime/main';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  teamsBasePath: '',
}));

vi.mock('@main/utils/pathDecoder', () => ({
  getTeamsBasePath: () => mocks.teamsBasePath,
}));

const tempDirs: string[] = [];

describe('CodexTeamLanesService config projection', () => {
  beforeEach(async () => {
    mocks.teamsBasePath = await mkdtemp(path.join(os.tmpdir(), 'codex-lane-config-sync-'));
    tempDirs.push(mocks.teamsBasePath);
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('projects the in-memory binding without reading interactive-runtime.json', async () => {
    const teamName = 'in-memory-lanes';
    const teamDir = path.join(mocks.teamsBasePath, teamName);
    await mkdir(teamDir, { recursive: true });
    await writeFile(
      path.join(teamDir, 'config.json'),
      JSON.stringify({
        name: teamName,
        members: [{ name: 'lead', agentType: 'team-lead', tmuxPaneId: '%0' }],
      })
    );
    const binding: InteractiveRuntimeBinding = {
      version: 2,
      runtime: 'codex-lanes',
      teamName,
      runId: 'run-1',
      tmuxSessionName: 'agteams-in-memory-lanes-run-1',
      leadSessionId: null,
      sessionTeamName: null,
      leadPaneId: '%10',
      lanes: [
        { memberName: 'lead', isLead: true, paneId: '%10', windowIndex: 0 },
        { memberName: 'researcher', isLead: false, paneId: '%11', windowIndex: 1 },
      ],
      launchedAt: '2026-08-09T00:00:00.000Z',
    };

    await new CodexTeamLanesService().syncAppConfigMembers(binding, '/tmp/project');

    const config = JSON.parse(await readFile(path.join(teamDir, 'config.json'), 'utf8')) as {
      members: Record<string, unknown>[];
    };
    expect(config.members).toEqual([
      expect.objectContaining({
        name: 'lead',
        tmuxPaneId: '%10',
        backendType: 'tmux',
        isActive: true,
        providerId: 'codex',
      }),
      expect.objectContaining({
        name: 'researcher',
        tmuxPaneId: '%11',
        backendType: 'tmux',
        isActive: true,
        providerId: 'codex',
        cwd: '/tmp/project',
      }),
    ]);
    await expect(
      readFile(path.join(teamDir, 'interactive-runtime.json'), 'utf8')
    ).rejects.toThrow();
  });
});

/* eslint-enable sonarjs/publicly-writable-directories -- Re-enable after temp-path fixtures. */
