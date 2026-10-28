// @vitest-environment node
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  teamIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import { startAgentTeamsWorker } from '@claude-teams/agent-teams-worker';
import { expect, it, vi } from 'vitest';

import { RelayAccountStore } from '../../../../packages/agent-teams-relay/src/accountPortal/accountStore';
import { createGoogleSignInProvider } from '../../../../packages/agent-teams-relay/src/accountPortal/googleAuth';
import { startInstallerPortal } from '../../../../packages/agent-teams-relay/src/installerPortalServer';

const origin = 'https://relay.example.test';
const provider = {
  authorizationUrl: ({ state, nonce }: { state: string; nonce: string; verifier: string }) =>
    'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ state, nonce }),
  exchange: vi.fn(async ({ code }: { code: string; nonce: string; verifier: string }) => ({
    sub: code,
    email: code + '@example.test',
    name: code === 'owner' ? 'Team Owner' : 'Team Member',
  })),
};

it('revokes only an owned, unchanged device credential and persists removal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'accounts-revoke-'));
  let store = new RelayAccountStore(root);
  try {
    const a = store.signIn({ sub: 'a', email: 'a@example.test', name: 'A' });
    const b = store.signIn({ sub: 'b', email: 'b@example.test', name: 'B' });
    const teamId = randomUUID();
    store.addOwner(teamId, a.user.id);
    const { token, device } = store.createDevice(teamId, a.user.id, 'waiting');
    expect(() => store.revokeDevice(b.user.id, device.id, null)).toThrow('Device not found');
    const nodeId = randomUUID();
    expect(store.bindDevice(device.id, nodeId)).toBe(true);
    expect(() => store.revokeDevice(a.user.id, device.id, null)).toThrow('This device changed');
    expect(store.resolveDevice(token)).toBeDefined();
    store.revokeDevice(a.user.id, device.id, nodeId);
    expect(store.resolveDevice(token)).toBeUndefined();
    expect(store.bindDevice(device.id, nodeId)).toBe(false);
    const removedAt = store.device(device.id)!.revokedAt;
    store.revokeDevice(a.user.id, device.id, nodeId);
    expect(store.device(device.id)!.revokedAt).toBe(removedAt);
    store.close();
    store = new RelayAccountStore(root);
    expect(store.resolveDevice(token)).toBeUndefined();
    expect(store.device(device.id)!.revokedAt).toBe(removedAt);
    expect(store.membership(teamId, a.user.id)).toBeDefined();
  } finally {
    store.close();
  }
});

it('persists sessions and memberships, consumes bound login state once, and rejects reused/expired/revoked invitations', async () => {
  let now = Date.now();
  const root = await mkdtemp(join(tmpdir(), 'accounts-store-'));
  let store = new RelayAccountStore(root, () => now);
  try {
    const a = store.signIn({ sub: 'a', email: 'a@example.test', name: 'A' }),
      b = store.signIn({ sub: 'b', email: 'b@example.test', name: 'B' }),
      c = store.signIn({ sub: 'c', email: 'c@example.test', name: 'C' });
    const team = randomUUID();
    store.addOwner(team, a.user.id);
    const installation = store.createDevice(team, a.user.id, 'test-device');
    expect(store.resolveDevice(installation.token)?.id).toBe(installation.device.id);
    const firstNode = randomUUID();
    expect(store.bindDevice(installation.device.id, firstNode)).toBe(true);
    expect(store.bindDevice(installation.device.id, firstNode)).toBe(true);
    expect(store.bindDevice(installation.device.id, randomUUID())).toBe(false);
    const login = store.createLogin('?invite=test');
    expect(store.consumeLogin(login.state, 'wrong')).toBeUndefined();
    expect(store.consumeLogin(login.state, login.browser)?.verifier).toBe(login.verifier);
    expect(store.consumeLogin(login.state, login.browser)).toBeUndefined();
    const invite = store.createInvite(team, a.user.id, 'b@example.test');
    expect(() => store.acceptInvite(invite.token, c.user)).toThrow(/different Google account/);
    expect(store.acceptInvite(invite.token, b.user)).toBe(team);
    expect(store.acceptInvite(invite.token, b.user)).toBe(team);
    expect(() => store.acceptInvite(invite.token, c.user)).toThrow(/already been used/);
    const revoked = store.createInvite(team, a.user.id);
    store.revokeInvite(team, a.user.id, revoked.invite.id);
    expect(() => store.acceptInvite(revoked.token, c.user)).toThrow(/revoked/);
    const expired = store.createInvite(team, a.user.id);
    now += 8 * 86400_000;
    expect(() => store.acceptInvite(expired.token, c.user)).toThrow(/expired/);
    expect(store.session(a.token)).toBeUndefined();
    const fresh = store.signIn({ sub: 'a', email: 'a@example.test', name: 'A' });
    expect(fresh.user.id).toBe(a.user.id);
    store.close();
    store = new RelayAccountStore(root, () => now);
    expect(store.session(fresh.token)?.user.id).toBe(a.user.id);
    expect(store.memberships(b.user.id)).toHaveLength(1);
  } finally {
    store.close();
  }
});

it('verifies Google signatures, issuer, audience, expiry, nonce and verified email with PKCE', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const claims = {
    iss: 'https://accounts.google.com',
    aud: 'client-id',
    sub: 'google-sub',
    email: 'member@example.test',
    email_verified: true,
    nonce: 'nonce',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  let overrides: Record<string, unknown> = {};
  const token = () => {
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString(
      'base64url'
    );
    const body = Buffer.from(JSON.stringify({ ...claims, ...overrides })).toString('base64url');
    const input = head + '.' + body;
    return input + '.' + sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
  };
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('oauth2/v3/certs'))
      return new Response(
        JSON.stringify({
          keys: [
            { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' },
          ],
        }),
        { headers: { 'content-type': 'application/json' } }
      );
    expect(String(input)).toBe('https://oauth2.googleapis.com/token');
    expect(String(init?.body)).toContain('code_verifier=verifier');
    return new Response(JSON.stringify({ id_token: token() }));
  });
  vi.stubGlobal('fetch', fetcher);
  try {
    const google = createGoogleSignInProvider(
      { clientId: 'client-id', clientSecret: 'test-only-client-secret' },
      origin + '/callback'
    );
    const url = new URL(
      google.authorizationUrl({ state: 'state', nonce: 'nonce', verifier: 'verifier' })
    );
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const input = { code: 'test-code', nonce: 'nonce', verifier: 'verifier' };
    expect((await google.exchange(input)).sub).toBe('google-sub');
    for (const bad of [
      { aud: 'another-client' },
      { iss: 'https://attacker.test' },
      { exp: 1 },
      { nonce: 'other' },
      { email_verified: false },
      { azp: 'another-client' },
    ]) {
      overrides = bad;
      await expect(google.exchange(input)).rejects.toThrow();
    }
  } finally {
    vi.unstubAllGlobals();
  }
});

it('runs Google login, scoped team creation, invitation acceptance, dashboard and native enrollment through the installer gateway', async () => {
  const root = await mkdtemp(join(tmpdir(), 'accounts-portal-'));
  const relay = await startAgentTeamsRelay({
    host: '127.0.0.1',
    port: 0,
    dataDir: root,
    auth: { managerToken: 'm'.repeat(40), workerToken: 'w'.repeat(40) },
    joinPortal: {
      publicUrl: origin + '/next',
      accounts: { provider },
      installer: {
        template: 'RUNTIME_KIND="__RUNTIME_KIND__"\nTOKEN="__WORKER_TOKEN__"\n__PAYLOAD_BELOW__\n',
        stock: {
          template:
            'RUNTIME_KIND="__RUNTIME_KIND__"\nTOKEN="__WORKER_TOKEN__"\n__PAYLOAD_BELOW__\n',
          platformBundles: { 'darwin-x64': Buffer.from('direct-stock-worker') },
        },
      },
    },
  });
  const gateway = await startInstallerPortal({
    host: '127.0.0.1',
    port: 0,
    upstreamUrl: relay.httpUrl,
    joinPortal: {
      publicUrl: origin + '/next',
      accounts: {},
      installer: {
        template: 'TOKEN="__WORKER_TOKEN__"\nTEAM="__TEAM_ID__"\n__PAYLOAD_BELOW__\n',
        platformBundles: { 'darwin-x64': Buffer.from('native-test-fixture') },
        stock: {
          template:
            'RUNTIME_KIND="__RUNTIME_KIND__"\nTOKEN="__WORKER_TOKEN__"\n__PAYLOAD_BELOW__\n',
          platformBundles: { 'darwin-x64': Buffer.from('proxy-stock-worker') },
        },
      },
    },
  });
  const workers: Awaited<ReturnType<typeof startAgentTeamsWorker>>[] = [];
  const login = async (code: string) => {
    const start = await gateway.app.inject({ url: '/join/auth/google' });
    expect(start.statusCode).toBe(302);
    const url = new URL(String(start.headers.location));
    const cookie = String(start.headers['set-cookie']).split(';')[0];
    expect(String(start.headers['set-cookie'])).toContain('HttpOnly');
    expect(String(start.headers['set-cookie'])).toContain('Secure');
    const callback = await gateway.app.inject({
      url: '/join/auth/google/callback?state=' + url.searchParams.get('state') + '&code=' + code,
      headers: { cookie },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(origin + '/next/join/');
    const cookies = callback.headers['set-cookie'];
    const sessionCookie = (Array.isArray(cookies) ? cookies : [String(cookies)])
      .find((c) => c.startsWith('agent_teams_session='))!
      .split(';')[0];
    const session = (
      await gateway.app.inject({
        url: '/join/api/account/session',
        headers: { cookie: sessionCookie },
      })
    ).json();
    expect(session.user.email).toBe(code + '@example.test');
    return { cookie: sessionCookie, origin, 'x-csrf-token': session.csrf };
  };
  try {
    expect((await gateway.app.inject({ url: '/join/' })).body).toContain('Good work starts');
    expect((await gateway.app.inject({ url: '/join/?legacy=1' })).body).toContain(
      'Private device pairing code'
    );
    expect((await gateway.app.inject({ url: '/join/api/account/dashboard' })).statusCode).toBe(401);
    const owner = await login('owner'),
      member = await login('member'),
      outsider = await login('outsider');
    expect(
      (
        await gateway.app.inject({
          method: 'POST',
          url: '/join/api/account/teams',
          headers: { cookie: owner.cookie },
          payload: { name: 'Test' },
        })
      ).statusCode
    ).toBe(403);
    const created = await gateway.app.inject({
      method: 'POST',
      url: '/join/api/account/teams',
      headers: owner,
      payload: { name: 'Private test team', description: 'Disposable account flow test' },
    });
    expect(created.statusCode).toBe(201);
    const team = created.json().team;
    expect((await gateway.app.inject({ url: '/join/api/teams' })).json().teams).toEqual([]);
    expect(
      (
        await gateway.app.inject({
          url: '/join/api/account/teams/' + team.teamId,
          headers: outsider,
        })
      ).statusCode
    ).toBe(404);
    const invitation = await gateway.app.inject({
      method: 'POST',
      url: '/join/api/account/teams/' + team.teamId + '/invites',
      headers: owner,
      payload: { email: 'member@example.test' },
    });
    expect(invitation.statusCode).toBe(201);
    const token = new URL(invitation.json().url).searchParams.get('invite');
    const preview = (
      await gateway.app.inject({ url: '/join/api/account/invites/' + token })
    ).json();
    expect(preview.team.name).toBe('Private test team');
    expect(preview).not.toHaveProperty('email');
    expect(
      (
        await gateway.app.inject({
          method: 'POST',
          url: '/join/api/account/invites/' + token + '/accept',
          headers: outsider,
          payload: {},
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await gateway.app.inject({
          method: 'POST',
          url: '/join/api/account/invites/' + token + '/accept',
          headers: member,
          payload: {},
        })
      ).statusCode
    ).toBe(200);
    const dashboard = (
      await gateway.app.inject({ url: '/join/api/account/dashboard', headers: member })
    ).json();
    expect(dashboard.teams).toHaveLength(1);
    expect(dashboard.teams[0].role).toBe('member');
    expect(dashboard.teams[0].devices).toEqual([]);
    expect(
      (
        await gateway.app.inject({
          method: 'POST',
          url: '/join/api/account/teams/' + team.teamId + '/invites',
          headers: member,
          payload: {},
        })
      ).statusCode
    ).toBe(404);
    const session = (
      await gateway.app.inject({ url: '/join/api/account/session', headers: member })
    ).json();
    expect(session.installerPlatforms.map((p: { id: string }) => p.id)).toEqual(['darwin-x64']);
    const denied = await gateway.app.inject({
      method: 'POST',
      url: '/join/api/account/teams/' + team.teamId + '/installer',
      headers: outsider,
      payload: { label: 'test-mac', platform: 'darwin-x64' },
    });
    expect(denied.statusCode).toBe(404);
    for (const target of [gateway, relay]) {
      for (const runtime of ['stock', 'unknown']) {
        const invalid = await target.app.inject({
          method: 'POST',
          url: '/join/api/account/teams/' + team.teamId + '/installer',
          headers: member,
          payload: { label: 'invalid-build', platform: 'linux-x64', runtime },
        });
        expect(invalid.statusCode).toBe(400);
      }
    }
    const afterInvalid = (
      await gateway.app.inject({ url: '/join/api/account/dashboard', headers: member })
    ).json();
    expect(afterInvalid.devices).toEqual([]);
    const installer = await gateway.app.inject({
      method: 'POST',
      url: '/join/api/account/teams/' + team.teamId + '/installer',
      headers: member,
      payload: { label: 'test-mac', platform: 'darwin-x64' },
    });
    expect(installer.statusCode).toBe(200);
    expect(installer.headers['content-type']).toContain('text/x-shellscript');
    expect(installer.body).toContain(team.teamId);
    const deviceToken = /TOKEN="([^"]+)"/.exec(installer.body)![1];
    expect(deviceToken).toMatch(/^atd_/);
    const worker = await startAgentTeamsWorker({
      relayUrl: relay.wsUrl,
      relayToken: deviceToken,
      dataDir: join(root, 'test-worker'),
      organizationId: organizationIdSchema.parse(randomUUID()),
      personId: personIdSchema.parse(randomUUID()),
      nodeId: nodeIdSchema.parse(randomUUID()),
      workerInstanceId: workerInstanceIdSchema.parse(randomUUID()),
      workerGeneration: 1,
      label: 'account-device-test',
      autoJoinTeamId: teamIdSchema.parse(team.teamId),
      reconnectDelayMs: 100,
    });
    workers.push(worker);
    await worker.ready;
    await vi.waitFor(async () => {
      const d = (
        await gateway.app.inject({ url: '/join/api/account/dashboard', headers: member })
      ).json();
      expect(d.devices[0]).toMatchObject({
        online: false,
        computerConnected: true,
        reason: 'session_disconnected',
      });
      expect(d.teams[0].agents).toHaveLength(1);
    });
    const enrollment = (
      await gateway.app.inject({ url: '/join/api/account/dashboard', headers: member })
    ).json().devices[0];
    expect(
      (
        await gateway.app.inject({
          method: 'POST',
          url: '/join/api/account/devices/' + enrollment.id + '/chat',
          headers: outsider,
          payload: { action: 'context', requestId: randomUUID() },
        })
      ).statusCode
    ).toBe(404);
    for (const target of [gateway, relay]) {
      const stockInstaller = await target.app.inject({
        method: 'POST',
        url: '/join/api/account/teams/' + team.teamId + '/installer',
        headers: member,
        payload: { label: 'stock-device', platform: 'darwin-x64', runtime: 'stock' },
      });
      expect(stockInstaller.statusCode).toBe(200);
      expect(stockInstaller.body).toContain('RUNTIME_KIND="stock"');
      expect(stockInstaller.headers['content-disposition']).toContain('-stock-darwin-x64.sh');
    }
    const devicesBeforeRemoval = (
      await gateway.app.inject({ url: '/join/api/account/dashboard', headers: member })
    ).json().devices;
    const waiting = devicesBeforeRemoval.find((d: { nodeId: string | null }) => !d.nodeId);
    const remove = (id: string, headers: typeof member, expectedNodeId: string | null) =>
      gateway.app.inject({
        method: 'POST',
        url: '/join/api/account/devices/' + id + '/remove',
        headers,
        payload: { expectedNodeId },
      });
    expect((await remove(waiting.id, owner, null)).statusCode).toBe(404);
    expect(
      (await remove(waiting.id, { cookie: member.cookie } as typeof member, null)).statusCode
    ).toBe(403);
    expect((await remove(waiting.id, member, null)).statusCode).toBe(200);
    expect((await remove(enrollment.id, member, null)).statusCode).toBe(409);
    expect(worker.getStatus().state).toBe('connected');
    const second = (
      await gateway.app.inject({
        method: 'POST',
        url: '/join/api/account/teams/' + team.teamId + '/installations',
        headers: member,
        payload: { label: 'keep-online' },
      })
    ).json();
    const survivor = await startAgentTeamsWorker({
      relayUrl: relay.wsUrl,
      relayToken: second.token,
      dataDir: join(root, 'surviving-worker'),
      organizationId: organizationIdSchema.parse(randomUUID()),
      personId: personIdSchema.parse(randomUUID()),
      nodeId: nodeIdSchema.parse(randomUUID()),
      workerInstanceId: workerInstanceIdSchema.parse(randomUUID()),
      workerGeneration: 1,
      label: 'keep-online',
      autoJoinTeamId: teamIdSchema.parse(team.teamId),
      reconnectDelayMs: 100,
    });
    workers.push(survivor);
    await survivor.ready;
    await vi.waitFor(async () => {
      const view = (
        await gateway.app.inject({ url: '/join/api/account/dashboard', headers: member })
      ).json();
      expect(view.teams[0].agents).toHaveLength(2);
    });
    expect((await remove(enrollment.id, outsider, enrollment.nodeId)).statusCode).toBe(404);
    expect((await remove(enrollment.id, member, enrollment.nodeId)).statusCode).toBe(200);
    await vi.waitFor(async () => {
      const view = (
        await gateway.app.inject({ url: '/join/api/account/dashboard', headers: member })
      ).json();
      expect(
        view.devices.some((d: { id: string }) => [waiting.id, enrollment.id].includes(d.id))
      ).toBe(false);
      expect(view.devices.find((d: { id: string }) => d.id === second.device.id)).toMatchObject({
        online: false,
        computerConnected: true,
      });
      expect(view.teams[0].agents).toHaveLength(1);
      expect(worker.getStatus().state).toBe('reconnecting');
      expect(survivor.getStatus().state).toBe('connected');
    });
    await gateway.app.inject({
      method: 'POST',
      url: '/join/api/account/logout',
      headers: member,
      payload: {},
    });
    expect(
      (await gateway.app.inject({ url: '/join/api/account/dashboard', headers: member })).statusCode
    ).toBe(401);
    const start = await gateway.app.inject({ url: '/join/auth/google' });
    const state = new URL(String(start.headers.location)).searchParams.get('state');
    const rejected = await gateway.app.inject({
      url: '/join/auth/google/callback?state=' + state + '&code=owner',
      headers: { cookie: 'agent_teams_login=' + 'x'.repeat(43) },
    });
    expect(rejected.headers.location).toContain('authError=sign_in_failed');
  } finally {
    for (const w of workers) await w.stop();
    await gateway.close();
    await relay.close();
  }
}, 20000);
