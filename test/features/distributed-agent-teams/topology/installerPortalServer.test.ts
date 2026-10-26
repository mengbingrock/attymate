// @vitest-environment node
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';

import { startInstallerPortal } from '../../../../packages/agent-teams-relay/src/installerPortalServer';

it('serves native installers using the existing relay for token checks, revocation, and rate limits', async () => {
  const manager = { authorization: 'Bearer ' + 'm'.repeat(40) };
  const upstream = await startAgentTeamsRelay({
    host: '127.0.0.1',
    port: 0,
    dataDir: await mkdtemp(join(tmpdir(), 'agent-teams-portal-proxy-')),
    auth: { managerToken: 'm'.repeat(40), workerToken: 'w'.repeat(40) },
    joinPortal: {
      publicUrl: 'https://relay.example/next',
      maxFailuresPerClient: 2,
      installer: { template: 'old', workerBundleTgz: Buffer.from('old') },
    },
  });
  const portal = await startInstallerPortal({
    host: '127.0.0.1',
    port: 0,
    upstreamUrl: upstream.httpUrl,
    joinPortal: {
      publicUrl: 'https://relay.example/next',
      installer: {
        template: 'TOKEN="__WORKER_TOKEN__"\nRELAY="__RELAY_URL__"\n__PAYLOAD_BELOW__\n',
        platformBundles: {
          'darwin-x64': Buffer.from('mac-fork'),
          'linux-x64': Buffer.from('linux-fork'),
        },
      },
    },
  });
  try {
    const created = (
      await upstream.app.inject({
        method: 'POST',
        url: '/v2/team-directory',
        headers: manager,
        payload: { name: 'Portal test', coordination: 'led' },
      })
    ).json();
    const download = (token: string, address = '198.51.100.2') =>
      portal.app.inject({
        method: 'POST',
        url: `/join/api/teams/${created.team.teamId}/installer`,
        headers: { 'x-forwarded-for': address },
        payload: { token, platform: 'darwin-x64' },
      });
    const catalog = (await portal.app.inject({ url: '/join/api/teams' })).json();
    expect(catalog.teams[0].teamId).toBe(created.team.teamId);
    expect(catalog.installerPlatforms.map((platform: { id: string }) => platform.id)).toEqual([
      'darwin-x64',
      'linux-x64',
    ]);
    expect((await download('wrong')).statusCode).toBe(401);
    const result = await download(created.joinToken);
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('wss://relay.example/next/v2/worker-stream');
    expect(Buffer.from(result.body.split('__PAYLOAD_BELOW__\n')[1], 'base64').toString()).toBe(
      'mac-fork'
    );
    expect((await download('wrong')).statusCode).toBe(401);
    const throttled = await download(created.joinToken);
    expect(throttled.statusCode).toBe(429);
    expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);
    const rotated = (
      await upstream.app.inject({
        method: 'POST',
        url: `/v2/team-directory/${created.team.teamId}/join-token`,
        headers: manager,
      })
    ).json();
    expect((await download(created.joinToken, '198.51.100.3')).statusCode).toBe(401);
    expect((await download(rotated.joinToken, '198.51.100.3')).statusCode).toBe(200);
    expect(upstream.listWorkers()).toEqual([]);
    expect(upstream.listLeases()).toEqual([]);
    expect((await portal.app.inject({ url: '/ready' })).statusCode).toBe(200);
  } finally {
    await portal.close();
    await upstream.close();
  }
});

it('refuses a non-loopback upstream without opening a server', async () => {
  await expect(
    startInstallerPortal({
      host: '127.0.0.1',
      port: 0,
      upstreamUrl: 'https://example.com',
      joinPortal: {
        publicUrl: 'https://relay.example/next',
        installer: { template: '', workerBundleTgz: Buffer.from('x') },
      },
    })
  ).rejects.toThrow(/loopback HTTP origin/);
});
