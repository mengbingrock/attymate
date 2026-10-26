import { teamIdSchema } from '@claude-teams/agent-teams-protocol';
import Fastify from 'fastify';

import {
  installerCatalog,
  SECURITY_HEADERS,
  sendTeamInstaller,
  type RelayJoinPortalOptions,
} from './relayJoinPortal';
import { JOIN_PORTAL_APP_JS, JOIN_PORTAL_CSS, JOIN_PORTAL_HTML } from './relayJoinPortalAssets';
import {
  accountPortalHtml,
  ACCOUNT_PORTAL_CSS,
  ACCOUNT_PORTAL_JS,
  accountPrivacyHtml,
} from './accountPortal/accountAssets';

/** Serves native installers while the existing Relay continues owning teams, tokens, and leases. */
export const startInstallerPortal = async (options: {
  readonly host: string;
  readonly port: number;
  readonly upstreamUrl: string;
  readonly joinPortal: RelayJoinPortalOptions;
}) => {
  const upstream = new URL(options.upstreamUrl);
  if (
    upstream.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(upstream.hostname) ||
    upstream.username ||
    upstream.password ||
    upstream.search ||
    upstream.hash ||
    upstream.pathname !== '/'
  ) {
    throw new Error('Installer portal upstream must be a loopback HTTP origin');
  }
  const catalog = installerCatalog(options.joinPortal.installer);
  if (!options.joinPortal.installer || !catalog.installerAvailable)
    throw new Error('Installer portal requires built installers');
  const installer = options.joinPortal.installer;
  const workerStreamUrl =
    options.joinPortal.publicUrl.replace(/\/$/, '').replace(/^http/, 'ws') + '/v2/worker-stream';
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  const proxy = async (path: string, forwardedFor?: string, body?: unknown) => {
    const response = await fetch(new URL(path, upstream), {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
      throw new Error('Invalid upstream response');
    return {
      status: response.status,
      body: payload as Record<string, unknown>,
      retryAfter: response.headers.get('retry-after'),
    };
  };
  app.addHook('onRequest', async (_request, reply) => {
    reply.headers(SECURITY_HEADERS).header('cache-control', 'no-store');
  });
  app.setErrorHandler((_error, _request, reply) => {
    void reply.code(503).send({ error: 'relay_unavailable' });
  });
  app.post('/join/api/desktop', async (request, reply) => {
    const response = await proxy('/join/api/desktop', undefined, request.body);
    return reply.code(response.status).send(response.body);
  });
  const accountProxy = async (
    request: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply
  ) => {
    if (!['GET', 'POST'].includes(request.method))
      return reply.code(405).send({ error: 'method_not_allowed' });
    const installerMatch = /^\/join\/api\/account\/teams\/([a-f0-9-]+)\/installer$/.exec(
      request.url
    );
    const body = request.body as { platform?: unknown; label?: unknown } | undefined;
    if (installerMatch && !catalog.installerPlatforms.some((p) => p.id === body?.platform))
      return reply.code(400).send({ error: 'Choose an available build for your computer.' });
    const path = installerMatch
      ? '/join/api/account/teams/' + installerMatch[1] + '/installations'
      : request.url;
    const response = await fetch(new URL(path, upstream), {
      method: request.method,
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
        ...(request.headers.origin ? { origin: request.headers.origin } : {}),
        ...(typeof request.headers['x-csrf-token'] === 'string'
          ? { 'x-csrf-token': request.headers['x-csrf-token'] }
          : {}),
        ...(request.method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(request.method === 'POST'
        ? { body: JSON.stringify(installerMatch ? { label: body?.label } : request.body) }
        : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header('set-cookie', cookies);
    const location = response.headers.get('location');
    if (location && response.status >= 300 && response.status < 400)
      return reply.code(response.status).header('location', location).send();
    const data = (await response.json()) as Record<string, unknown>;
    if (installerMatch && response.ok) {
      if (typeof data.token !== 'string' || data.teamId !== installerMatch[1])
        throw new Error('Invalid device enrollment');
      return sendTeamInstaller(reply, installer, body?.platform, {
        relayUrl: workerStreamUrl,
        token: data.token,
        teamId: installerMatch[1]!,
      });
    }
    return reply
      .code(response.status)
      .send(
        request.url === '/join/api/account/session' && response.ok ? { ...data, ...catalog } : data
      );
  };
  app.all('/join/api/account/*', accountProxy);
  app.get('/join/auth/google', accountProxy);
  app.get('/join/auth/google/callback', accountProxy);
  app.get('/health', () => ({
    ok: true,
    service: 'agent-teams-installer-portal',
    platforms: catalog.installerPlatforms,
  }));
  app.get('/ready', async (_request, reply) => {
    const response = await proxy('/ready');
    return reply.code(response.status).send(response.body);
  });
  app.get('/join', (_request, reply) => reply.code(302).header('location', 'join/').send());
  app.get('/join/', (request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(
        options.joinPortal.accounts && (request.query as { legacy?: string }).legacy !== '1'
          ? accountPortalHtml(options.joinPortal.publicUrl)
          : JOIN_PORTAL_HTML
      )
  );
  app.get('/join/account.js', (_request, reply) =>
    reply.type('text/javascript; charset=utf-8').send(ACCOUNT_PORTAL_JS)
  );
  app.get('/join/account.css', (_request, reply) =>
    reply.type('text/css; charset=utf-8').send(ACCOUNT_PORTAL_CSS)
  );
  app.get('/join/privacy', (_request, reply) =>
    reply.type('text/html; charset=utf-8').send(accountPrivacyHtml(options.joinPortal.publicUrl))
  );
  app.get('/join/app.js', (_request, reply) =>
    reply.type('text/javascript; charset=utf-8').send(JOIN_PORTAL_APP_JS)
  );
  app.get('/join/app.css', (_request, reply) =>
    reply.type('text/css; charset=utf-8').send(JOIN_PORTAL_CSS)
  );
  app.get('/join/api/teams', async (_request, reply) => {
    const response = await proxy('/join/api/teams');
    return reply
      .code(response.status)
      .send(response.status === 200 ? { ...response.body, ...catalog } : response.body);
  });
  for (const action of ['verify', 'installer'] as const) {
    app.post(`/join/api/teams/:teamId/${action}`, async (request, reply) => {
      const parsed = teamIdSchema.safeParse((request.params as { teamId?: unknown }).teamId);
      if (!parsed.success) return reply.code(401).send({ error: 'invalid_team_token' });
      const body =
        typeof request.body === 'object' && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {};
      const forwarded = request.headers['x-forwarded-for'];
      const response = await proxy(
        `/join/api/teams/${parsed.data}/verify`,
        Array.isArray(forwarded) ? forwarded.join(',') : forwarded,
        { token: body.token }
      );
      if (response.status !== 200) {
        if (response.retryAfter && /^\d+$/.test(response.retryAfter))
          reply.header('retry-after', response.retryAfter);
        return reply.code(response.status).send(response.body);
      }
      if (action === 'verify') return { ...response.body, ...catalog, workerStreamUrl };
      if (typeof body.token !== 'string')
        return reply.code(401).send({ error: 'invalid_team_token' });
      return sendTeamInstaller(reply, installer, body.platform, {
        relayUrl: workerStreamUrl,
        token: body.token,
        teamId: parsed.data,
      });
    });
  }
  const httpUrl = await app.listen({ host: options.host, port: options.port });
  return { app, httpUrl, wsUrl: '', close: () => app.close() };
};
