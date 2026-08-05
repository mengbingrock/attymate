// @vitest-environment node
import * as fs from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let teamsBasePath: string;

vi.mock('@main/utils/pathDecoder', () => ({
  getTeamsBasePath: () => teamsBasePath,
}));

vi.mock('@shared/utils/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

import { synthesizeStockClaudeTeamRuntimeState } from '@main/services/team/provisioning/StockClaudeTeamStateSynthesizer';

describe('StockClaudeTeamStateSynthesizer', () => {
  beforeEach(async () => {
    teamsBasePath = await mkdtemp(path.join(tmpdir(), 'stock-synth-'));
  });

  afterEach(async () => {
    await rm(teamsBasePath, { recursive: true, force: true });
  });

  it('writes a valid config.json with lead and roster members plus inbox stubs', async () => {
    await synthesizeStockClaudeTeamRuntimeState({
      teamName: 'alpha',
      cwd: '/tmp/project',
      description: 'test team',
      members: [
        { name: 'alice', model: 'claude-sonnet-5' },
        { name: 'bob', role: 'reviewer' },
      ],
      providerId: 'anthropic',
    });

    const config = JSON.parse(
      await readFile(path.join(teamsBasePath, 'alpha', 'config.json'), 'utf-8')
    );
    expect(config.name).toBe('alpha');
    expect(config.leadAgentId).toBe('team-lead@alpha');
    expect(config.members.map((m: { name: string }) => m.name)).toEqual([
      'team-lead',
      'alice',
      'bob',
    ]);
    expect(config.members[0].agentType).toBe('team-lead');
    expect(config.members[1].model).toBe('claude-sonnet-5');
    // Members are registered as PENDING, not active: the lead must still spawn
    // each teammate via the Agent tool at bootstrap.
    expect(config.members[1].isActive).toBe(false);
    expect(config.members[1].backendType).toBeUndefined();

    const aliceInbox = JSON.parse(
      await readFile(path.join(teamsBasePath, 'alpha', 'inboxes', 'alice.json'), 'utf-8')
    );
    expect(aliceInbox).toEqual([]);
    expect(fs.existsSync(path.join(teamsBasePath, 'alpha', 'inboxes', 'bob.json'))).toBe(true);
  });

  it('never overwrites an existing config.json or inbox file', async () => {
    const teamDir = path.join(teamsBasePath, 'beta');
    const inboxesDir = path.join(teamDir, 'inboxes');
    await fs.promises.mkdir(inboxesDir, { recursive: true });
    const existingConfig = JSON.stringify({ name: 'beta', members: [], custom: true });
    await fs.promises.writeFile(path.join(teamDir, 'config.json'), existingConfig);
    const existingInbox = JSON.stringify([{ from: 'user', text: 'hi' }]);
    await fs.promises.writeFile(path.join(inboxesDir, 'carol.json'), existingInbox);

    await synthesizeStockClaudeTeamRuntimeState({
      teamName: 'beta',
      cwd: '/tmp/project',
      members: [{ name: 'carol' }],
    });

    expect(await readFile(path.join(teamDir, 'config.json'), 'utf-8')).toBe(existingConfig);
    expect(await readFile(path.join(inboxesDir, 'carol.json'), 'utf-8')).toBe(existingInbox);
  });

  it('uses an imported profile as the only lead and never registers it as a teammate', async () => {
    await synthesizeStockClaudeTeamRuntimeState({
      teamName: 'legal-team',
      cwd: '/tmp/legal-project',
      lead: {
        name: 'legal-ops-supervisor',
        role: 'Legal operations supervisor',
        workflow: 'Coordinate the matter.',
        model: 'claude-opus-5',
      },
      members: [{ name: 'calendar-agent' }, { name: 'docket-agent' }],
      providerId: 'anthropic',
    });

    const config = JSON.parse(
      await readFile(path.join(teamsBasePath, 'legal-team', 'config.json'), 'utf-8')
    );
    expect(config.lead).toEqual({
      name: 'legal-ops-supervisor',
      agentId: 'legal-ops-supervisor@legal-team',
    });
    expect(config.leadAgentId).toBe('legal-ops-supervisor@legal-team');
    expect(config.members.map((member: { name: string }) => member.name)).toEqual([
      'legal-ops-supervisor',
      'calendar-agent',
      'docket-agent',
    ]);
    expect(
      config.members.filter((member: { agentType?: string }) => member.agentType === 'team-lead')
    ).toHaveLength(1);
    expect(
      fs.existsSync(path.join(teamsBasePath, 'legal-team', 'inboxes', 'legal-ops-supervisor.json'))
    ).toBe(false);
  });
});
