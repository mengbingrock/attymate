import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { readTeamRuntimeFacts } from '@features/matter-dashboard/main';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let teamsBasePath: string;

async function writeTeam(
  teamName: string,
  files: Record<string, unknown>
): Promise<void> {
  const teamDir = path.join(teamsBasePath, teamName);
  await fs.mkdir(teamDir, { recursive: true });
  for (const [fileName, content] of Object.entries(files)) {
    await fs.writeFile(path.join(teamDir, fileName), JSON.stringify(content), 'utf8');
  }
}

const CLAUDE_TEAM = {
  'config.json': {
    members: [
      { name: 'team-lead', agentType: 'team-lead', provider: 'anthropic' },
      { name: 'calendar-agent' },
    ],
  },
};

const CODEX_TEAM = {
  'config.json': {
    members: [
      { name: 'team-lead', agentType: 'team-lead', provider: 'codex' },
      { name: 'calendar-agent', provider: 'codex' },
    ],
  },
};

beforeEach(async () => {
  teamsBasePath = await fs.mkdtemp(path.join(os.tmpdir(), 'team-runtime-facts-'));
});

afterEach(async () => {
  await fs.rm(teamsBasePath, { recursive: true, force: true });
});

describe('readTeamRuntimeFacts', () => {
  it('reports teammates excluding the lead', async () => {
    await writeTeam('claude-team', CLAUDE_TEAM);

    await expect(readTeamRuntimeFacts(teamsBasePath, 'claude-team')).resolves.toEqual({
      hasTeammates: true,
      canSpawnTeammates: true,
    });
  });

  it('reports a solo team as having no teammates', async () => {
    await writeTeam('solo-team', {
      'config.json': { members: [{ name: 'team-lead', agentType: 'team-lead' }] },
    });

    await expect(readTeamRuntimeFacts(teamsBasePath, 'solo-team')).resolves.toMatchObject({
      hasTeammates: false,
    });
  });

  it('forbids spawning while a codex-lanes runtime is live', async () => {
    await writeTeam('lanes-team', {
      ...CLAUDE_TEAM,
      'interactive-runtime.json': { version: 2, runtime: 'codex-lanes' },
    });

    await expect(readTeamRuntimeFacts(teamsBasePath, 'lanes-team')).resolves.toMatchObject({
      canSpawnTeammates: false,
    });
  });

  it('still forbids spawning for a stopped codex team, whose binding file is gone', async () => {
    await writeTeam('stopped-codex-team', CODEX_TEAM);

    await expect(readTeamRuntimeFacts(teamsBasePath, 'stopped-codex-team')).resolves.toMatchObject({
      canSpawnTeammates: false,
    });
  });

  it('falls back to the team provider when the roster carries none', async () => {
    await writeTeam('meta-codex-team', {
      'config.json': { members: [{ name: 'team-lead', agentType: 'team-lead' }] },
      'team.meta.json': { providerId: 'codex' },
    });

    await expect(readTeamRuntimeFacts(teamsBasePath, 'meta-codex-team')).resolves.toMatchObject({
      canSpawnTeammates: false,
    });
  });

  it('degrades safely when a team has no persisted state at all', async () => {
    await expect(readTeamRuntimeFacts(teamsBasePath, 'missing-team')).resolves.toEqual({
      hasTeammates: false,
      canSpawnTeammates: true,
    });
  });
});
