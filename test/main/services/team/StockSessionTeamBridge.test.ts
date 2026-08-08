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

import {
  deliverStockSessionTeamDm,
  getStockSessionTeamName,
  isStockSessionTeamActive,
} from '@main/services/team/provisioning/StockSessionTeamBridge';

const LEAD_SESSION_ID = '24887392-4d4c-41f3-af85-dbeddf266c8b';
const TEAM_NAME = 'session-24887392';

describe('StockSessionTeamBridge', () => {
  beforeEach(async () => {
    teamsBasePath = await mkdtemp(path.join(tmpdir(), 'stock-bridge-'));
  });

  afterEach(async () => {
    await rm(teamsBasePath, { recursive: true, force: true });
  });

  it('derives the session team name from the lead session id', () => {
    expect(getStockSessionTeamName(LEAD_SESSION_ID)).toBe(TEAM_NAME);
    expect(getStockSessionTeamName('short')).toBeNull();
    expect(getStockSessionTeamName('ZZZZZZZZ-not-hex')).toBeNull();
    expect(getStockSessionTeamName(undefined)).toBeNull();
  });

  it('reports inactive when the runtime never materialized a team', async () => {
    expect(await isStockSessionTeamActive(LEAD_SESSION_ID)).toBe(false);
    expect(
      await deliverStockSessionTeamDm(LEAD_SESSION_ID, { memberName: 'echo', text: 'hi' })
    ).toBe(false);
  });

  it('routes a custom-named lead DM to the session team lead mailbox', async () => {
    // The app-side lead is "legal-ops-supervisor" (imported lead profile), but
    // the stock runtime registers its lead as "team-lead" — the session team
    // has no mailbox under the custom name.
    const teamDir = path.join(teamsBasePath, TEAM_NAME);
    await fs.promises.mkdir(path.join(teamDir, 'inboxes'), { recursive: true });
    await fs.promises.writeFile(
      path.join(teamDir, 'config.json'),
      JSON.stringify({
        name: TEAM_NAME,
        leadAgentId: `team-lead@${TEAM_NAME}`,
        members: [
          { name: 'team-lead', agentType: 'team-lead' },
          { name: 'source-intake-agent' },
        ],
      })
    );

    const delivered = await deliverStockSessionTeamDm(LEAD_SESSION_ID, {
      memberName: 'legal-ops-supervisor',
      deliverToLead: true,
      text: 'hello lead',
    });

    expect(delivered).toBe(true);
    const inbox = JSON.parse(
      await readFile(path.join(teamDir, 'inboxes', 'team-lead.json'), 'utf-8')
    ) as Record<string, unknown>[];
    expect(inbox).toHaveLength(1);
    expect(inbox[0].text).toBe('hello lead');
    // The custom name got no stray mailbox of its own.
    expect(fs.existsSync(path.join(teamDir, 'inboxes', 'legal-ops-supervisor.json'))).toBe(false);
  });

  it('still fails closed for a non-lead unknown member, even with the flag', async () => {
    const teamDir = path.join(teamsBasePath, TEAM_NAME);
    await fs.promises.mkdir(path.join(teamDir, 'inboxes'), { recursive: true });
    await fs.promises.writeFile(
      path.join(teamDir, 'config.json'),
      JSON.stringify({ name: TEAM_NAME, members: [] })
    );
    expect(
      await deliverStockSessionTeamDm(LEAD_SESSION_ID, {
        memberName: 'ghost',
        text: 'nope',
      })
    ).toBe(false);
  });

  it('appends a well-formed mailbox entry for a registered member', async () => {
    const teamDir = path.join(teamsBasePath, TEAM_NAME);
    await fs.promises.mkdir(path.join(teamDir, 'inboxes'), { recursive: true });
    await fs.promises.writeFile(
      path.join(teamDir, 'config.json'),
      JSON.stringify({ name: TEAM_NAME, members: [{ name: 'team-lead' }, { name: 'echo' }] })
    );
    const existing = [{ from: 'team-lead', text: 'earlier', msgV: 1, type: 'message' }];
    await fs.promises.writeFile(
      path.join(teamDir, 'inboxes', 'echo.json'),
      JSON.stringify(existing)
    );

    const delivered = await deliverStockSessionTeamDm(LEAD_SESSION_ID, {
      memberName: 'echo',
      text: 'direct hello',
      summary: 'greeting',
    });

    expect(delivered).toBe(true);
    const inbox = JSON.parse(
      await readFile(path.join(teamDir, 'inboxes', 'echo.json'), 'utf-8')
    ) as Record<string, unknown>[];
    expect(inbox).toHaveLength(2);
    expect(inbox[0].text).toBe('earlier');
    const entry = inbox[1];
    expect(entry.from).toBe('user');
    expect(entry.text).toBe('direct hello');
    expect(entry.summary).toBe('greeting');
    expect(entry.msgV).toBe(1);
    expect(entry.type).toBe('message');
    expect(entry.read).toBe(false);
    expect(typeof entry.msg_id).toBe('string');
    expect(typeof entry.timestamp).toBe('string');
  });

  it('refuses delivery to a member missing from the session team config', async () => {
    const teamDir = path.join(teamsBasePath, TEAM_NAME);
    await fs.promises.mkdir(teamDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(teamDir, 'config.json'),
      JSON.stringify({ name: TEAM_NAME, members: [{ name: 'team-lead' }] })
    );

    expect(
      await deliverStockSessionTeamDm(LEAD_SESSION_ID, { memberName: 'ghost', text: 'hi' })
    ).toBe(false);
    expect(fs.existsSync(path.join(teamDir, 'inboxes', 'ghost.json'))).toBe(false);
  });
});
