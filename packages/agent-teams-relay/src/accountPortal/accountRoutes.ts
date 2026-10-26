import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { desktopChatActionSchema, teamIdSchema } from '@claude-teams/agent-teams-protocol';

import {
  installerCatalog,
  sendTeamInstaller,
  SECURITY_HEADERS,
  type RelayJoinPortalOptions,
} from '../relayJoinPortal';
import type { RelayTeamDirectoryStore } from '../relayTeamDirectoryStore';
import type { RelayMembershipRouteStore } from '../relayMembershipRouteStore';
import type { RelayDesktopChats } from '../relayDesktopChats';
import { AccountPortalError, type AccountSession, type RelayAccountStore } from './accountStore';
import {
  createGoogleSignInProvider,
  type GoogleSignInConfig,
  type GoogleSignInProvider,
} from './googleAuth';

export interface AccountPortalOptions {
  readonly google?: GoogleSignInConfig;
  /** Dependency injection for isolated tests; never selected by an environment variable. */
  readonly provider?: GoogleSignInProvider;
}

const SESSION_COOKIE = 'agent_teams_session';
const LOGIN_COOKIE = 'agent_teams_login';
const cookie = (request: FastifyRequest, name: string): string | undefined => {
  const value = (request.headers.cookie ?? '')
    .split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + '='))
    ?.slice(name.length + 1);
  return value && /^[\w-]{43}$/.test(value) ? value : undefined;
};
const sameSecret = (a: string | undefined, b: string): boolean => {
  if (!a) return false;
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const registerAccountRoutes = (deps: {
  app: FastifyInstance;
  store: RelayAccountStore;
  options: RelayJoinPortalOptions;
  directory: RelayTeamDirectoryStore;
  routes: RelayMembershipRouteStore;
  desktop: RelayDesktopChats;
  online: () => ReadonlySet<string>;
  setCoordination: (
    teamId: ReturnType<typeof teamIdSchema.parse>,
    coordination: 'led' | 'leaderless'
  ) => void;
}) => {
  const { app, store, options, directory, routes, desktop } = deps;
  const base = new URL(options.publicUrl.replace(/\/$/, '') + '/join/');
  if (
    base.protocol !== 'https:' &&
    !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
  )
    throw new Error('Account portal requires HTTPS, except on loopback.');
  const secure = base.protocol === 'https:';
  const provider =
    options.accounts?.provider ??
    (options.accounts?.google
      ? createGoogleSignInProvider(
          options.accounts.google,
          new URL('auth/google/callback', base).href
        )
      : undefined);
  const setCookie = (reply: FastifyReply, name: string, value: string, maxAge: number) =>
    reply.header(
      'set-cookie',
      `${name}=${value}; Path=${base.pathname}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
    );
  const signedIn = (request: FastifyRequest, mutation = false): AccountSession => {
    const session = store.session(cookie(request, SESSION_COOKIE));
    if (!session) throw new AccountPortalError(401, 'Sign in with Google to continue.');
    if (
      mutation &&
      (request.headers.origin !== base.origin ||
        !sameSecret(
          typeof request.headers['x-csrf-token'] === 'string'
            ? request.headers['x-csrf-token']
            : undefined,
          session.csrf
        ))
    )
      throw new AccountPortalError(403, 'Refresh this page before trying again.');
    return session;
  };
  const safe =
    (handler: (request: FastifyRequest, reply: FastifyReply) => unknown | Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      reply.headers(SECURITY_HEADERS).header('cache-control', 'no-store');
      try {
        return await handler(request, reply);
      } catch (error) {
        const status =
          error instanceof AccountPortalError
            ? error.status
            : error instanceof z.ZodError || error instanceof TypeError
              ? 400
              : 503;
        return reply.code(status).send({
          error:
            error instanceof AccountPortalError
              ? error.message
              : status === 400
                ? 'Check the form and try again.'
                : 'This action could not be completed. Try again shortly.',
        });
      }
    };
  const teamIdOf = (request: FastifyRequest) =>
    teamIdSchema.parse((request.params as { teamId: string }).teamId);
  const requireTeam = (teamId: string, userId: string, owner = false) => {
    store.requireMember(teamId, userId, owner);
    const team = directory.get(teamId);
    if (!team) throw new AccountPortalError(404, 'Team not found.');
    return team;
  };
  const deviceView = (userId: string) =>
    store
      .devices(userId)
      .filter((d) => !d.revokedAt)
      .map((d) => ({ ...d, online: !!d.nodeId && deps.online().has(d.nodeId) }));
  const teamView = (teamId: string, userId: string) => {
    const team = requireTeam(teamId, userId);
    const agents = routes
      .listAll()
      .filter((r) => r.teamId === teamId && r.status === 'active')
      .map((r) => ({ label: r.label, role: r.role, online: deps.online().has(r.nodeId) }));
    const membership = store.requireMember(teamId, userId);
    return {
      ...team,
      role: membership.role,
      coordination: routes.teamSettings(team.teamId).coordination,
      members: store.members(teamId),
      agents,
      devices: deviceView(userId).filter((d) => d.teamId === teamId),
      invites: membership.role === 'owner' ? store.invites(teamId) : [],
    };
  };

  app.get(
    '/join/api/account/session',
    safe((request) => ({
      configured: !!provider,
      user: store.session(cookie(request, SESSION_COOKIE))?.user ?? null,
      csrf: store.session(cookie(request, SESSION_COOKIE))?.csrf ?? null,
      ...installerCatalog(options.installer),
    }))
  );
  app.get(
    '/join/auth/google',
    safe((request, reply) => {
      if (!provider)
        throw new AccountPortalError(503, 'Google sign-in is temporarily unavailable.');
      const query = z
        .object({
          invite: z
            .string()
            .regex(/^ati_[\w-]{43}$/)
            .optional(),
        })
        .parse(request.query);
      const next = query.invite ? '?invite=' + encodeURIComponent(query.invite) : '';
      const login = store.createLogin(next);
      setCookie(reply, LOGIN_COOKIE, login.browser, 600);
      return reply.redirect(provider.authorizationUrl(login));
    })
  );
  app.get(
    '/join/auth/google/callback',
    safe(async (request, reply) => {
      const query = z
        .object({
          state: z.string().regex(/^[\w-]{43}$/),
          code: z.string().min(1).max(4096).optional(),
          error: z.string().max(200).optional(),
        })
        .safeParse(request.query);
      const browser = cookie(request, LOGIN_COOKIE);
      const login =
        query.success && browser ? store.consumeLogin(query.data.state, browser) : undefined;
      setCookie(reply, LOGIN_COOKIE, '', 0);
      if (!login || !query.success || !query.data.code || query.data.error || !provider)
        return reply.redirect(base.href + '?authError=sign_in_failed');
      try {
        const identity = await provider.exchange({
          code: query.data.code,
          nonce: login.nonce,
          verifier: login.verifier,
        });
        const session = store.signIn(identity);
        // Fastify preserves both Set-Cookie headers: expire login state and establish the session.
        setCookie(reply, SESSION_COOKIE, session.token, 7 * 86400);
        return reply.redirect(base.href + login.next);
      } catch {
        return reply.redirect(base.href + '?authError=sign_in_failed');
      }
    })
  );
  app.post(
    '/join/api/account/logout',
    safe((request, reply) => {
      signedIn(request, true);
      store.signOut(cookie(request, SESSION_COOKIE)!);
      setCookie(reply, SESSION_COOKIE, '', 0);
      return { ok: true };
    })
  );
  app.get(
    '/join/api/account/dashboard',
    safe((request) => {
      const { user } = signedIn(request);
      return {
        teams: store
          .memberships(user.id)
          .filter((m) => directory.get(m.teamId))
          .map((m) => teamView(m.teamId, user.id)),
        devices: deviceView(user.id),
      };
    })
  );
  app.post(
    '/join/api/account/teams',
    safe((request, reply) => {
      const { user } = signedIn(request, true);
      const input = z
        .object({
          name: z.string().trim().min(1).max(80),
          description: z.string().trim().max(500).default(''),
          coordination: z.enum(['leaderless', 'led']).default('leaderless'),
        })
        .strict()
        .parse(request.body);
      if (store.memberships(user.id).length >= 50)
        throw new AccountPortalError(429, 'Team limit reached.');
      const team = directory.upsert({
        name: input.name,
        description: input.description,
        listed: false,
      });
      try {
        store.addOwner(team.teamId, user.id);
      } catch (error) {
        directory.remove(team.teamId);
        throw error;
      }
      deps.setCoordination(team.teamId, input.coordination);
      return reply.code(201).send({ team: teamView(team.teamId, user.id) });
    })
  );
  app.get(
    '/join/api/account/teams/:teamId',
    safe((request) => {
      const { user } = signedIn(request);
      return { team: teamView(teamIdOf(request), user.id) };
    })
  );
  app.post(
    '/join/api/account/teams/:teamId/invites',
    safe((request, reply) => {
      const { user } = signedIn(request, true),
        teamId = teamIdOf(request);
      requireTeam(teamId, user.id, true);
      const input = z
        .object({ email: z.email().max(254).optional() })
        .strict()
        .parse(request.body);
      const result = store.createInvite(teamId, user.id, input.email);
      return reply
        .code(201)
        .send({ invite: result.invite, url: base.href + '?invite=' + result.token });
    })
  );
  app.post(
    '/join/api/account/teams/:teamId/invites/:inviteId/revoke',
    safe((request) => {
      const { user } = signedIn(request, true);
      const teamId = teamIdOf(request);
      requireTeam(teamId, user.id, true);
      store.revokeInvite(
        teamId,
        user.id,
        z.uuid().parse((request.params as { inviteId: string }).inviteId)
      );
      return { ok: true };
    })
  );
  app.get(
    '/join/api/account/invites/:token',
    safe((request) => {
      const token = z
        .string()
        .regex(/^ati_[\w-]{43}$/)
        .parse((request.params as { token: string }).token);
      const invite = store.invite(token);
      const session = store.session(cookie(request, SESSION_COOKIE));
      if (
        !invite ||
        invite.revokedAt ||
        (invite.expiresAt <= Date.now() && invite.acceptedBy !== session?.user.id) ||
        (invite.acceptedBy && invite.acceptedBy !== session?.user.id)
      )
        throw new AccountPortalError(
          410,
          'This invitation is no longer available. Ask the owner for a new link.'
        );
      const team = directory.get(invite.teamId);
      if (!team) throw new AccountPortalError(410, 'This team is no longer available.');
      return {
        team: { teamId: team.teamId, name: team.name, description: team.description },
        inviter: store.user(invite.inviterId)?.name ?? 'A teammate',
        expiresAt: invite.expiresAt,
        emailRestricted: !!invite.email,
        alreadyJoined: !!session && !!store.membership(invite.teamId, session.user.id),
      };
    })
  );
  app.post(
    '/join/api/account/invites/:token/accept',
    safe((request) => {
      const { user } = signedIn(request, true);
      const token = z
        .string()
        .regex(/^ati_[\w-]{43}$/)
        .parse((request.params as { token: string }).token);
      const invite = store.invite(token);
      if (!invite || !directory.get(invite.teamId))
        throw new AccountPortalError(410, 'This invitation is no longer available.');
      const teamId = store.acceptInvite(token, user);
      return { team: teamView(teamId, user.id) };
    })
  );
  app.post(
    '/join/api/account/teams/:teamId/installer',
    safe((request, reply) => {
      const { user } = signedIn(request, true),
        teamId = teamIdOf(request);
      requireTeam(teamId, user.id);
      const input = z
        .object({
          platform: z.string(),
          label: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9._-]{1,40}$/),
        })
        .strict()
        .parse(request.body);
      const catalog = installerCatalog(options.installer);
      if (!options.installer || !catalog.installerPlatforms.some((p) => p.id === input.platform))
        throw new AccountPortalError(400, 'Choose an available build for your computer.');
      const { token } = store.createDevice(teamId, user.id, input.label);
      return sendTeamInstaller(reply, options.installer, input.platform, {
        relayUrl: options.publicUrl.replace(/\/$/, '').replace(/^http/, 'ws') + '/v2/worker-stream',
        token,
        teamId,
      });
    })
  );
  // The installer gateway owns native archives; the relay issues only this user's device credential.
  app.post(
    '/join/api/account/teams/:teamId/installations',
    safe((request, reply) => {
      const { user } = signedIn(request, true),
        teamId = teamIdOf(request);
      requireTeam(teamId, user.id);
      const { label } = z
        .object({
          label: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9._-]{1,40}$/),
        })
        .strict()
        .parse(request.body);
      return reply.code(201).send({ ...store.createDevice(teamId, user.id, label), teamId });
    })
  );
  app.post(
    '/join/api/account/teams/:teamId/devices/pair',
    safe((request) => {
      const { user } = signedIn(request, true),
        teamId = teamIdOf(request);
      requireTeam(teamId, user.id);
      const { pairingCode } = z
        .object({ pairingCode: z.string().regex(/^[\w-]{43}$/) })
        .strict()
        .parse(request.body);
      const device = desktop.identify(pairingCode);
      if (
        !device ||
        !routes
          .listAll()
          .some((r) => r.nodeId === device.nodeId && r.teamId === teamId && r.status === 'active')
      )
        throw new AccountPortalError(
          403,
          'Check the pairing code and make sure this device is connected to this team.'
        );
      return { device: store.claimDevice(teamId, user.id, device.nodeId, device.label) };
    })
  );
  app.post(
    '/join/api/account/devices/:deviceId/chat',
    safe(async (request) => {
      const { user } = signedIn(request, true);
      const device = store.device(
        z.uuid().parse((request.params as { deviceId: string }).deviceId)
      );
      if (!device || device.userId !== user.id || device.revokedAt || !device.nodeId)
        throw new AccountPortalError(404, 'Connected device not found.');
      requireTeam(device.teamId, user.id);
      const action = desktopChatActionSchema.parse(request.body);
      if (action.teamId && action.teamId !== device.teamId)
        throw new AccountPortalError(403, 'Select this device’s team.');
      if (
        action.action !== 'context' &&
        action.action !== 'default' &&
        action.teamId !== device.teamId
      )
        throw new AccountPortalError(400, 'Select a team for this chat.');
      try {
        const raw = await desktop.request(device.nodeId, action);
        const result = raw as {
          teams?: { teamId: string }[];
          chats?: { teamId: string }[];
          defaultTeamId?: string | null;
        };
        return {
          result: {
            ...result,
            teams: result.teams?.filter((t) => t.teamId === device.teamId),
            chats: result.chats?.filter((c) => c.teamId === device.teamId),
            defaultTeamId: result.defaultTeamId === device.teamId ? result.defaultTeamId : null,
          },
        };
      } catch (error) {
        throw new AccountPortalError(
          409,
          error instanceof Error ? error.message : 'The device did not respond.'
        );
      }
    })
  );
};
