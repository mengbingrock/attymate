import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { TeamDataService } from '../../../../src/main/services/team/TeamDataService';
import { setClaudeBasePathOverride } from '../../../../src/main/utils/pathDecoder';

const tempPaths: string[] = [];

afterEach(async () => {
  setClaudeBasePathOverride(null);
  await Promise.all(
    tempPaths.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

async function makeFixture(): Promise<{
  teamName: string;
  teamDir: string;
  oldProject: string;
  newProject: string;
}> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'change-path-'));
  tempPaths.push(base);
  setClaudeBasePathOverride(base);

  const teamName = 'repoint-team';
  const teamDir = path.join(base, 'teams', teamName);
  await fs.mkdir(teamDir, { recursive: true });
  const oldProject = path.join(base, 'projects', 'old-case');
  const newProject = path.join(base, 'projects', 'new-case');
  await fs.mkdir(oldProject, { recursive: true });
  await fs.mkdir(newProject, { recursive: true });

  await fs.writeFile(
    path.join(teamDir, 'config.json'),
    JSON.stringify({
      name: teamName,
      projectPath: oldProject,
      projectPathHistory: [oldProject],
      members: [{ name: 'team-lead', agentType: 'team-lead', cwd: oldProject }],
    })
  );
  await fs.writeFile(
    path.join(teamDir, 'team.meta.json'),
    JSON.stringify({ version: 1, displayName: teamName, cwd: oldProject, createdAt: Date.now() })
  );
  await fs.writeFile(
    path.join(teamDir, 'members.meta.json'),
    JSON.stringify({
      version: 1,
      members: [
        { name: 'writer', role: 'Writer', workflow: 'Write.', cwd: oldProject },
        { name: 'roamer', role: 'Roamer', workflow: 'Roam.', cwd: '/somewhere/else' },
      ],
    })
  );
  return { teamName, teamDir, oldProject, newProject };
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;
}

describe('TeamDataService.changeProjectPath', () => {
  it('moves config, launch meta, and matching member cwds to the new folder', async () => {
    const { teamName, teamDir, oldProject, newProject } = await makeFixture();
    const service = new TeamDataService();

    const applied = await service.changeProjectPath(teamName, newProject);
    expect(applied).toBe(newProject);

    const config = await readJson(path.join(teamDir, 'config.json'));
    expect(config.projectPath).toBe(newProject);
    // The old path stays discoverable in history; the new one is appended.
    expect(config.projectPathHistory).toEqual([oldProject, newProject]);

    const meta = await readJson(path.join(teamDir, 'team.meta.json'));
    expect(meta.cwd).toBe(newProject);

    const membersMeta = (await readJson(path.join(teamDir, 'members.meta.json'))) as {
      members: { name: string; cwd?: string }[];
    };
    const byName = new Map(membersMeta.members.map((member) => [member.name, member.cwd]));
    // The member that worked in the old project folder follows it…
    expect(byName.get('writer')).toBe(newProject);
    // …while a deliberately different cwd is left alone.
    expect(byName.get('roamer')).toBe('/somewhere/else');
  });

  it('rejects relative, missing, and non-directory paths', async () => {
    const { teamName, newProject } = await makeFixture();
    const service = new TeamDataService();

    await expect(service.changeProjectPath(teamName, 'relative/path')).rejects.toThrow(
      /absolute path/
    );
    await expect(
      service.changeProjectPath(teamName, path.join(newProject, 'does-not-exist'))
    ).rejects.toThrow(/does not exist/);

    const filePath = path.join(newProject, 'a-file.txt');
    await fs.writeFile(filePath, 'x');
    await expect(service.changeProjectPath(teamName, filePath)).rejects.toThrow(
      /not a directory/
    );
  });

  it('throws for an unknown team', async () => {
    const { newProject } = await makeFixture();
    const service = new TeamDataService();
    await expect(service.changeProjectPath('ghost-team', newProject)).rejects.toThrow(
      /Team not found/
    );
  });
});
