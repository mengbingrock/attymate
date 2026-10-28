// @vitest-environment node

import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  teamIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import { startAgentTeamsWorker } from '@claude-teams/agent-teams-worker';
import { describe, expect, it, vi } from 'vitest';

const MANAGER_TOKEN = 'm'.repeat(40);
const WORKER_TOKEN = 'w'.repeat(40);
const PUBLIC_URL = 'https://relay.example.test/next';
const manager = { authorization: `Bearer ${MANAGER_TOKEN}` };

const workerOptions = (
  relayUrl: string,
  dataRoot: string,
  suffix: string,
  relayToken: string,
  autoJoinTeamId: string
) =>
  ({
    relayUrl,
    relayToken,
    dataDir: join(dataRoot, `worker-${suffix}`),
    organizationId: organizationIdSchema.parse('40000000-0000-4000-8000-000000000001'),
    personId: personIdSchema.parse(`40000000-0000-4000-8000-0000000001${suffix}`),
    nodeId: nodeIdSchema.parse(`40000000-0000-4000-8000-0000000002${suffix}`),
    workerInstanceId: workerInstanceIdSchema.parse(`40000000-0000-4000-8000-0000000003${suffix}`),
    workerGeneration: 1,
    label: `peer-${suffix}`,
    autoJoinTeamId: teamIdSchema.parse(autoJoinTeamId),
    reconnectDelayMs: 25,
    leaseSweepIntervalMs: 10,
  }) as const;

describe('team directory and public join portal', () => {
  it('lists teams without secrets, hands out installers for a valid token, and scopes Workers to their team', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agent-teams-join-portal-'));
    const template = await readFile(
      resolve(__dirname, '../../../../packages/agent-teams-worker/installer/install-template.sh'),
      'utf8'
    );
    const workerBundleTgz = gzipSync(Buffer.from('fake worker bundle'));
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(dataRoot, 'relay'),
      heartbeatIntervalMs: 20,
      leaseDurationMs: 2_000,
      auth: { managerToken: MANAGER_TOKEN, workerToken: WORKER_TOKEN },
      joinPortal: {
        publicUrl: `${PUBLIC_URL}/`,
        installer: { template, workerBundleTgz },
        repository: { url: 'https://github.com/example/agent-teams.git', branch: 'main' },
        maxFailuresPerClient: 3,
        maxFailuresShared: 5,
      },
    });
    const workers: Awaited<ReturnType<typeof startAgentTeamsWorker>>[] = [];

    try {
      // --- Manager API is token-protected and returns the join token exactly once.
      expect(
        (
          await relay.app.inject({
            method: 'POST',
            url: '/v2/team-directory',
            payload: { name: 'x' },
          })
        ).statusCode
      ).toBe(401);
      const created = await relay.app.inject({
        method: 'POST',
        url: '/v2/team-directory',
        headers: manager,
        payload: {
          name: 'Paper triage',
          description: 'Reads new preprints',
          coordination: 'leaderless',
        },
      });
      expect(created.statusCode).toBe(201);
      const { team, joinToken } = created.json<{ team: { teamId: string }; joinToken: string }>();
      expect(created.json()).toMatchObject({
        team: { name: 'Paper triage', coordination: 'leaderless' },
      });
      const hidden = (
        await relay.app.inject({
          method: 'POST',
          url: '/v2/team-directory',
          headers: manager,
          payload: { name: 'Private crew', listed: false },
        })
      ).json<{ team: { teamId: string }; joinToken: string }>();
      const listedForManager = await relay.app.inject({
        url: '/v2/team-directory',
        headers: manager,
      });
      expect(JSON.stringify(listedForManager.json())).not.toContain('atj_');

      // --- Public page and listing: no auth, no secrets, unlisted teams hidden, security headers set.
      const redirect = await relay.app.inject({ url: '/join' });
      expect(redirect.statusCode).toBe(302);
      expect(redirect.headers.location).toBe('join/');
      const page = await relay.app.inject({ url: '/join/' });
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-type']).toContain('text/html');
      expect(page.headers['content-security-policy']).toContain("script-src 'self'");
      expect(page.headers['x-content-type-options']).toBe('nosniff');
      expect(page.body).toContain('src="app.js"');
      expect((await relay.app.inject({ url: '/join/app.js' })).headers['content-type']).toContain(
        'javascript'
      );
      const listing = await relay.app.inject({ url: '/join/api/teams' });
      expect(listing.json()).toMatchObject({
        teams: [
          {
            teamId: team.teamId,
            name: 'Paper triage',
            description: 'Reads new preprints',
            coordination: 'leaderless',
            members: 0,
            online: 0,
            memberList: [],
          },
        ],
        installerAvailable: true,
        installerPlatforms: [],
      });
      expect(listing.body).not.toContain('atj_');
      expect(listing.body).not.toContain(hidden.team.teamId);

      // --- Token checks. Clients behind a non-loopback forwarded address get their own budget.
      const verify = (teamId: string, token: string, forwardedFor = '203.0.113.7') =>
        relay.app.inject({
          method: 'POST',
          url: `/join/api/teams/${teamId}/verify`,
          headers: { 'x-forwarded-for': forwardedFor },
          payload: { token },
        });
      expect((await verify(team.teamId, 'atj_wrong')).statusCode).toBe(401);
      expect((await verify(hidden.team.teamId, joinToken)).statusCode).toBe(401);
      expect((await verify('not-a-team', joinToken)).json()).toEqual({
        error: 'invalid_team_token',
      });
      // Three failures used the per-client budget, so even the right token is throttled now.
      const throttled = await verify(team.teamId, joinToken);
      expect(throttled.statusCode).toBe(429);
      expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);
      // Another client is unaffected and the hidden team stays joinable by its own token.
      const ok = await verify(team.teamId, joinToken, '198.51.100.4');
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({
        workerStreamUrl: 'wss://relay.example.test/next/v2/worker-stream',
        installerAvailable: true,
        repository: { branch: 'main' },
      });
      expect((await verify(hidden.team.teamId, hidden.joinToken, '198.51.100.4')).statusCode).toBe(
        200
      );

      // --- Installer: same framing as build-installer.sh with this team's values baked in.
      const installer = await relay.app.inject({
        method: 'POST',
        url: `/join/api/teams/${team.teamId}/installer`,
        headers: { 'x-forwarded-for': '198.51.100.4' },
        payload: { token: joinToken },
      });
      expect(installer.statusCode).toBe(200);
      expect(installer.headers['content-disposition']).toContain(
        `agent-teams-join-${team.teamId.slice(0, 8)}.sh`
      );
      expect(installer.body).toContain(
        'RELAY_URL="wss://relay.example.test/next/v2/worker-stream"'
      );
      expect(installer.body).toContain(`WORKER_TOKEN="${joinToken}"`);
      expect(installer.body).toContain(`TEAM_ID="${team.teamId}"`);
      const payload = installer.body.split('\n__PAYLOAD_BELOW__\n')[1] ?? '';
      expect(Buffer.from(payload.replace(/\n/g, ''), 'base64').equals(workerBundleTgz)).toBe(true);

      // --- Clients that cannot be told apart (loopback, no forwarded address) share one budget.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await relay.app.inject({
          method: 'POST',
          url: `/join/api/teams/${team.teamId}/verify`,
          payload: { token: 'atj_wrong' },
        });
      }
      expect(
        (
          await relay.app.inject({
            method: 'POST',
            url: `/join/api/teams/${team.teamId}/verify`,
            payload: { token: joinToken },
          })
        ).statusCode
      ).toBe(429);

      // --- Workers: a join token admits a Worker to its own team only.
      const member = await startAgentTeamsWorker(
        workerOptions(relay.wsUrl, dataRoot, '01', joinToken, team.teamId)
      );
      workers.push(member);
      await member.ready;
      await vi.waitFor(() =>
        expect(relay.listMembershipRoutes()).toEqual([
          expect.objectContaining({ teamId: team.teamId, role: 'member', status: 'active' }),
        ])
      );
      expect((await relay.app.inject({ url: '/join/api/teams' })).json().teams[0]).toMatchObject({
        members: 1,
        online: 1,
        memberList: [{ label: 'peer-01', role: 'member', online: true }],
      });
      // The manager cannot reuse that Worker for another team.
      const crossTeam = await relay.app.inject({
        method: 'POST',
        url: `/v2/teams/${hidden.team.teamId}/members`,
        headers: manager,
        payload: { targetNodeId: '40000000-0000-4000-8000-000000000201', role: 'member' },
      });
      expect(crossTeam.statusCode).toBe(500);
      expect(crossTeam.json().message).toContain('can only serve that team');

      const mismatched = await startAgentTeamsWorker(
        workerOptions(relay.wsUrl, dataRoot, '02', joinToken, hidden.team.teamId)
      );
      const bogus = await startAgentTeamsWorker(
        workerOptions(relay.wsUrl, dataRoot, '03', 'atj_' + 'x'.repeat(43), team.teamId)
      );
      workers.push(mismatched, bogus);
      await new Promise((settle) => setTimeout(settle, 300));
      expect(relay.listWorkers().map((worker) => worker.label)).toEqual(['peer-01']);

      // --- Rotation cuts off sessions that used the old token and the old token stops working.
      const rotated = await relay.app.inject({
        method: 'POST',
        url: `/v2/team-directory/${team.teamId}/join-token`,
        headers: manager,
      });
      const nextToken = rotated.json<{ joinToken: string }>().joinToken;
      expect(nextToken).not.toBe(joinToken);
      await vi.waitFor(() => expect(relay.listWorkers()).toEqual([]));
      const offlineListing = (await relay.app.inject({ url: '/join/api/teams' })).json();
      expect(offlineListing.teams[0].memberList).toEqual([
        { label: 'peer-01', role: 'member', online: false },
      ]);
      expect(offlineListing.teams[0].members).toBe(1);
      expect(offlineListing.teams[0].online).toBe(0);
      expect(JSON.stringify(offlineListing)).not.toContain('nodeId');
      expect((await verify(team.teamId, joinToken, '192.0.2.9')).statusCode).toBe(401);
      expect((await verify(team.teamId, nextToken, '192.0.2.9')).statusCode).toBe(200);
      expect(
        (
          await relay.app.inject({
            method: 'DELETE',
            url: `/v2/team-directory/${hidden.team.teamId}`,
            headers: manager,
          })
        ).json()
      ).toEqual({ removed: true });
    } finally {
      await Promise.allSettled(workers.map((worker) => worker.stop()));
      await relay.close();
    }
  });

  it('serves no portal routes unless the portal is configured', async () => {
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(await mkdtemp(join(tmpdir(), 'agent-teams-no-portal-')), 'relay'),
    });
    try {
      expect((await relay.app.inject({ url: '/join/' })).statusCode).toBe(404);
      expect((await relay.app.inject({ url: '/join/api/teams' })).statusCode).toBe(404);
    } finally {
      await relay.close();
    }
  });

  it('advertises available native builds and streams only the authenticated selected platform', async () => {
    const mac = gzipSync(randomBytes(100_001));
    const linux = gzipSync(randomBytes(73_003));
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: await mkdtemp(join(tmpdir(), 'agent-teams-platform-download-')),
      auth: { managerToken: MANAGER_TOKEN, workerToken: WORKER_TOKEN },
      joinPortal: {
        publicUrl: PUBLIC_URL,
        installer: {
          template:
            'RELAY="__RELAY_URL__"\nTOKEN="__WORKER_TOKEN__"\nTEAM="__TEAM_ID__"\n__PAYLOAD_BELOW__\n',
          platformBundles: { 'darwin-x64': mac, 'linux-x64': linux },
        },
      },
    });
    try {
      const created = await relay.app.inject({
        method: 'POST',
        url: '/v2/team-directory',
        headers: manager,
        payload: { name: 'Native downloads' },
      });
      const { team, joinToken } = created.json<{ team: { teamId: string }; joinToken: string }>();
      const expected = [
        { id: 'darwin-x64', label: 'macOS · Intel' },
        { id: 'linux-x64', label: 'Linux · Intel / AMD x64' },
      ];
      expect(
        (await relay.app.inject({ url: '/join/api/teams' })).json().installerPlatforms
      ).toEqual(expected);
      expect(
        (
          await relay.app.inject({
            method: 'POST',
            url: `/join/api/teams/${team.teamId}/verify`,
            payload: { token: joinToken },
          })
        ).json().installerPlatforms
      ).toEqual(expected);
      const download = (token: string, platform?: unknown) =>
        relay.app.inject({
          method: 'POST',
          url: `/join/api/teams/${team.teamId}/installer`,
          payload: { token, ...(platform === undefined ? {} : { platform }) },
        });
      expect((await download('invalid', 'darwin-x64')).statusCode).toBe(401);
      expect((await download(joinToken)).json()).toEqual({ error: 'installer_platform_required' });
      expect((await download(joinToken, 'darwin-arm64')).json()).toEqual({
        error: 'installer_platform_unavailable',
      });
      expect((await download(joinToken, '__proto__')).statusCode).toBe(400);
      for (const [platform, bytes] of [
        ['darwin-x64', mac],
        ['linux-x64', linux],
      ] as const) {
        const response = await download(joinToken, platform);
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-disposition']).toContain(`${platform}.sh`);
        expect(Number(response.headers['content-length'])).toBe(Buffer.byteLength(response.body));
        const payload = response.body.split('__PAYLOAD_BELOW__\n')[1];
        expect(Buffer.from(payload, 'base64')).toEqual(bytes);
        expect(response.body).toContain(`TOKEN="${joinToken}"`);
      }
    } finally {
      await relay.close();
    }
  });
});
