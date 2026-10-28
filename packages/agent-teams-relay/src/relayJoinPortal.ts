import { Readable } from 'node:stream';

import type { TeamCoordinationMode, TeamId } from '@claude-teams/agent-teams-protocol';
import { teamCoordinationModeSchema, teamIdSchema } from '@claude-teams/agent-teams-protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { JOIN_PORTAL_APP_JS, JOIN_PORTAL_CSS, JOIN_PORTAL_HTML } from './relayJoinPortalAssets';
import type { RelayMembershipRouteStore } from './relayMembershipRouteStore';
import type { RelayTeamDirectoryEntry, RelayTeamDirectoryStore } from './relayTeamDirectoryStore';
import type { AccountPortalOptions } from './accountPortal/accountRoutes';
import {
  accountPortalHtml,
  ACCOUNT_PORTAL_CSS,
  ACCOUNT_PORTAL_JS,
  accountPrivacyHtml,
} from './accountPortal/accountAssets';

export const INSTALLER_PLATFORM_LABELS = {
  'darwin-x64': 'macOS · Intel',
  'darwin-arm64': 'macOS · Apple Silicon',
  'linux-x64': 'Linux · Intel / AMD x64',
  'linux-arm64': 'Linux · ARM64',
  'win32-x64': 'Windows · Intel / AMD x64',
} as const;
export type InstallerPlatform = keyof typeof INSTALLER_PLATFORM_LABELS;
export type InstallerRuntime = 'fork' | 'stock';

export interface InstallerDistribution {
  readonly template: string;
  readonly windowsTemplate?: string;
  readonly workerBundleTgz?: Buffer;
  readonly platformBundles?: Partial<Record<InstallerPlatform, Buffer>>;
}

export interface RelayJoinPortalOptions {
  readonly accounts?: AccountPortalOptions;
  /** Public base URL of this Relay, e.g. https://relay.example/next. Workers connect to its /v2/worker-stream. */
  readonly publicUrl: string;
  /** Installer template plus the gzipped worker bundle; without it the portal offers only clone steps. */
  readonly installer?: InstallerDistribution & {
    /** Worker-only distribution that uses the recipient's installed, unmodified Codex. */
    readonly stock?: InstallerDistribution;
  };
  /** Git repository and branch shown in the clone-and-run instructions. */
  readonly repository?: { readonly url: string; readonly branch: string };
  /** Failed token checks allowed per client in one window. */
  readonly maxFailuresPerClient?: number;
  /** Failed token checks allowed across all clients that share an unknown address. */
  readonly maxFailuresShared?: number;
  readonly failureWindowMs?: number;
}

interface PortalDependencies {
  readonly app: FastifyInstance;
  readonly teamDirectory: RelayTeamDirectoryStore;
  readonly membershipRouteStore: RelayMembershipRouteStore;
  readonly connectedNodeIds: () => ReadonlySet<string>;
  /** Applies a coordination mode with the Relay's full side effects (demotion, re-offers). */
  readonly setCoordination: (teamId: TeamId, coordination: TeamCoordinationMode) => void;
  /** Disconnects Worker sessions that authenticated with a now-revoked join token. */
  readonly revokeJoinTokenSessions: (tokenHash: string) => void;
}

/** In-memory sliding window counting failures per key. */
class FailureWindow {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly windowMs: number) {}

  retryAfterSeconds(key: string, limit: number, now = Date.now()): number | undefined {
    const recent = this.recent(key, now);
    if (recent.length < limit) return undefined;
    const oldest = recent[0] ?? now;
    return Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
  }

  record(key: string, now = Date.now()): void {
    const recent = this.recent(key, now);
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) {
      for (const [candidate, times] of this.hits) {
        if (times.every((time) => time <= now - this.windowMs)) this.hits.delete(candidate);
      }
    }
  }

  private recent(key: string, now: number): number[] {
    return (this.hits.get(key) ?? []).filter((time) => time > now - this.windowMs);
  }
}

const isLoopback = (address: string): boolean => {
  // IPv4 peers on a dual-stack socket arrive as IPv4-mapped IPv6 addresses.
  const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return normalized === '127.0.0.1' || normalized === '::1';
};

/**
 * Identifies the client for rate limiting. Behind a local reverse proxy the proxy's own appended
 * X-Forwarded-For entry (the last one) is trusted; earlier entries are client-controlled. When the
 * proxy itself only sees loopback (for example a TCP pass-through in front of it), clients cannot be
 * told apart and share one budget.
 */
const clientKey = (request: FastifyRequest): { readonly key: string; readonly shared: boolean } => {
  const peer = request.socket.remoteAddress ?? 'unknown';
  if (!isLoopback(peer)) return { key: peer, shared: false };
  const forwarded = request.headers['x-forwarded-for'];
  const last = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? ''))
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  if (last !== undefined && !isLoopback(last)) return { key: last, shared: false };
  return { key: 'shared', shared: true };
};

export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

const sendAsset = (reply: FastifyReply, contentType: string, body: string) =>
  reply
    .headers(SECURITY_HEADERS)
    .header('content-type', contentType)
    .header('cache-control', 'no-cache')
    .send(body);

const renderInstaller = (
  template: string,
  workerBundleTgz: Buffer,
  values: { readonly relayUrl: string; readonly token: string; readonly teamId: string },
  trailer = '',
  runtime: InstallerRuntime = 'fork'
): { readonly stream: Readable; readonly contentLength: number } => {
  // Same substitutions and payload framing as installer/build-installer.sh.
  const script = template
    .replace('__RELAY_URL__', values.relayUrl)
    .replace('__WORKER_TOKEN__', values.token)
    .replace('__TEAM_ID__', values.teamId)
    .replaceAll('__RUNTIME_KIND__', runtime);
  const header = script.endsWith('\n') ? script : script + '\n';
  // Keep the chunk size divisible by three so concatenated base64 has padding only at the end.
  // Encoding a native runtime as one string (then wrapping every line) can exhaust the relay heap.
  const chunkSize = 48 * 1024;
  function* chunks(): Generator<string> {
    yield header;
    for (let offset = 0; offset < workerBundleTgz.length; offset += chunkSize) {
      yield workerBundleTgz.subarray(offset, offset + chunkSize).toString('base64') + '\n';
    }
    if (trailer) yield trailer;
  }
  return {
    stream: Readable.from(chunks()),
    contentLength:
      Buffer.byteLength(header) +
      Buffer.byteLength(trailer) +
      4 * Math.ceil(workerBundleTgz.length / 3) +
      Math.ceil(workerBundleTgz.length / chunkSize),
  };
};

const templateMatchesRuntime = (template: string, runtime: InstallerRuntime): boolean => {
  const declared = /^\s*(?:RUNTIME_KIND|\$runtimeKind)\s*=\s*["'](fork|stock)["']/im.exec(
    template
  )?.[1];
  return declared === undefined || declared === runtime;
};

const distributionCatalog = (
  installer: InstallerDistribution | undefined,
  runtime: InstallerRuntime = 'fork'
) => {
  const installerPlatforms = Object.entries(INSTALLER_PLATFORM_LABELS)
    .filter(
      ([id]) =>
        installer?.platformBundles?.[id as InstallerPlatform] !== undefined &&
        templateMatchesRuntime(installer.template, runtime) &&
        (id !== 'win32-x64' ||
          (installer.windowsTemplate !== undefined &&
            templateMatchesRuntime(installer.windowsTemplate, runtime)))
    )
    .map(([id, label]) => ({ id, label }));
  return {
    installerPlatforms,
    installerAvailable:
      (installer?.workerBundleTgz !== undefined &&
        templateMatchesRuntime(installer.template, runtime)) ||
      installerPlatforms.length > 0,
  };
};

export const installerCatalog = (installer: RelayJoinPortalOptions['installer']) => ({
  // Legacy fields always describe the fork distribution.
  ...distributionCatalog(installer),
  installerRuntimes: (
    [
      ['fork', 'Use bundled team runtime', installer],
      ['stock', 'Use installed Codex', installer?.stock],
    ] as const
  )
    .map(([id, label, distribution]) => ({ id, label, ...distributionCatalog(distribution, id) }))
    .filter((runtime) => runtime.installerAvailable),
});

/** Resolve before enrollment so invalid runtime/platform requests create no device credential. */
export const resolveInstallerSelection = (
  installer: RelayJoinPortalOptions['installer'],
  platform: unknown,
  runtime: unknown = 'fork'
) => {
  if (runtime !== 'fork' && runtime !== 'stock') return undefined;
  const distribution = runtime === 'stock' ? installer?.stock : installer;
  if (!distribution) return undefined;
  const selected =
    typeof platform === 'string' && Object.hasOwn(INSTALLER_PLATFORM_LABELS, platform)
      ? (platform as InstallerPlatform)
      : undefined;
  const bundle =
    platform === undefined
      ? distribution.workerBundleTgz
      : selected === undefined
        ? undefined
        : distribution.platformBundles?.[selected];
  const windows = selected === 'win32-x64';
  const template = windows ? distribution.windowsTemplate : distribution.template;
  if (bundle === undefined || template === undefined || !templateMatchesRuntime(template, runtime))
    return undefined;
  return { runtime, platform: selected, bundle, template, windows } as const;
};

export const sendTeamInstaller = (
  reply: FastifyReply,
  installer: NonNullable<RelayJoinPortalOptions['installer']>,
  platform: unknown,
  values: { readonly relayUrl: string; readonly token: string; readonly teamId: string },
  runtime?: unknown
): FastifyReply => {
  const selection = resolveInstallerSelection(installer, platform, runtime);
  if (selection === undefined)
    return reply
      .code(400)
      .headers(SECURITY_HEADERS)
      .send({
        error:
          runtime !== undefined && runtime !== 'fork' && runtime !== 'stock'
            ? 'installer_runtime_unavailable'
            : platform === undefined
              ? 'installer_platform_required'
              : 'installer_platform_unavailable',
      });
  const { platform: selected, bundle, template, windows } = selection;
  const script = renderInstaller(
    template,
    bundle,
    values,
    windows ? '#>\n' : '',
    selection.runtime
  );
  return reply
    .headers(SECURITY_HEADERS)
    .header('cache-control', 'no-store')
    .header(
      'content-type',
      windows ? 'text/plain; charset=utf-8' : 'text/x-shellscript; charset=utf-8'
    )
    .header('content-length', String(script.contentLength))
    .header(
      'content-disposition',
      `attachment; filename="agent-teams-join-${values.teamId.slice(0, 8)}${runtime === undefined ? '' : '-' + selection.runtime}${selected === undefined ? '' : '-' + selected}.${windows ? 'ps1' : 'sh'}"`
    )
    .send(script.stream);
};

export const registerTeamDirectoryManagerRoutes = (deps: PortalDependencies): void => {
  const { app, teamDirectory, membershipRouteStore } = deps;
  const withCoordination = (entry: RelayTeamDirectoryEntry) => ({
    ...entry,
    coordination: membershipRouteStore.teamSettings(entry.teamId).coordination,
  });
  const body = (request: FastifyRequest): Record<string, unknown> =>
    typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body)
      ? (request.body as Record<string, unknown>)
      : {};

  app.get('/v2/team-directory', () => ({ teams: teamDirectory.list().map(withCoordination) }));

  /** Creates a directory entry and its first join token. The token is only ever returned here. */
  app.post('/v2/team-directory', (request, reply) => {
    const input = body(request);
    const teamId = input.teamId === undefined ? undefined : teamIdSchema.parse(input.teamId);
    if (teamId !== undefined && teamDirectory.get(teamId) !== undefined) {
      return reply.code(409).send({ error: 'team_already_in_directory' });
    }
    const entry = teamDirectory.upsert({
      ...(teamId === undefined ? {} : { teamId }),
      name: input.name,
      description: input.description,
      listed: input.listed,
    });
    if (input.coordination !== undefined) {
      deps.setCoordination(entry.teamId, teamCoordinationModeSchema.parse(input.coordination));
    }
    const { token } = teamDirectory.rotateJoinToken(entry.teamId);
    return reply
      .code(201)
      .send({ team: withCoordination(teamDirectory.get(entry.teamId)!), joinToken: token });
  });

  app.patch('/v2/team-directory/:teamId', (request, reply) => {
    const teamId = teamIdSchema.parse((request.params as { teamId?: unknown }).teamId);
    const existing = teamDirectory.get(teamId);
    if (existing === undefined) return reply.code(404).send({ error: 'team_not_in_directory' });
    const input = body(request);
    const entry = teamDirectory.upsert({
      teamId,
      name: input.name ?? existing.name,
      description: input.description,
      listed: input.listed,
    });
    return { team: withCoordination(entry) };
  });

  app.post('/v2/team-directory/:teamId/join-token', (request, reply) => {
    const teamId = teamIdSchema.parse((request.params as { teamId?: unknown }).teamId);
    if (teamDirectory.get(teamId) === undefined) {
      return reply.code(404).send({ error: 'team_not_in_directory' });
    }
    const rotated = teamDirectory.rotateJoinToken(teamId);
    if (rotated.previousTokenHash !== undefined)
      deps.revokeJoinTokenSessions(rotated.previousTokenHash);
    return { team: withCoordination(rotated.entry), joinToken: rotated.token };
  });

  app.delete('/v2/team-directory/:teamId', (request, reply) => {
    const teamId = teamIdSchema.parse((request.params as { teamId?: unknown }).teamId);
    const removed = teamDirectory.remove(teamId);
    if (!removed.removed) return reply.code(404).send({ error: 'team_not_in_directory' });
    if (removed.previousTokenHash !== undefined)
      deps.revokeJoinTokenSessions(removed.previousTokenHash);
    return { removed: true };
  });
};

/**
 * The public join portal at /join/. It lists directory teams without secrets and, for a caller that
 * presents a team's join token, hands out that team's installer and clone-and-run instructions.
 */
export const registerJoinPortal = (
  deps: PortalDependencies,
  options: RelayJoinPortalOptions
): void => {
  const { app, teamDirectory, membershipRouteStore } = deps;
  const publicUrl = new URL(options.publicUrl).toString().replace(/\/$/, '');
  const workerStreamUrl = `${publicUrl.replace(/^http/, 'ws')}/v2/worker-stream`;
  const failures = new FailureWindow(options.failureWindowMs ?? 10 * 60_000);
  const maxFailuresPerClient = options.maxFailuresPerClient ?? 20;
  const maxFailuresShared = options.maxFailuresShared ?? 300;
  const catalog = installerCatalog(options.installer);

  const publicTeam = (entry: RelayTeamDirectoryEntry) => {
    const connected = deps.connectedNodeIds();
    const members = membershipRouteStore.listActiveForTeam(entry.teamId);
    return {
      teamId: entry.teamId,
      name: entry.name,
      description: entry.description,
      coordination: membershipRouteStore.teamSettings(entry.teamId).coordination,
      members: members.length,
      online: members.filter((member) => connected.has(member.nodeId)).length,
      memberList: members
        .map((member) => ({
          label: member.label,
          role: member.role,
          online: connected.has(member.nodeId),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  };

  /** Validates the presented token for a team, applying the failure rate limit. */
  const authorize = (
    request: FastifyRequest,
    reply: FastifyReply
  ):
    | { readonly teamId: TeamId; readonly token: string; readonly entry: RelayTeamDirectoryEntry }
    | undefined => {
    const client = clientKey(request);
    const limit = client.shared ? maxFailuresShared : maxFailuresPerClient;
    const retryAfter = failures.retryAfterSeconds(client.key, limit);
    if (retryAfter !== undefined) {
      void reply
        .code(429)
        .headers(SECURITY_HEADERS)
        .header('retry-after', String(retryAfter))
        .send({ error: 'too_many_attempts', retryAfterSeconds: retryAfter });
      return undefined;
    }
    const rawTeamId = (request.params as { teamId?: unknown }).teamId;
    const token =
      typeof request.body === 'object' && request.body !== null
        ? (request.body as { token?: unknown }).token
        : undefined;
    const parsedTeamId = teamIdSchema.safeParse(rawTeamId);
    const entry = parsedTeamId.success ? teamDirectory.get(parsedTeamId.data) : undefined;
    if (
      !parsedTeamId.success ||
      entry === undefined ||
      typeof token !== 'string' ||
      !teamDirectory.verifyJoinToken(parsedTeamId.data, token)
    ) {
      failures.record(client.key);
      // One generic answer for unknown teams and wrong tokens, so the endpoint reveals nothing.
      void reply.code(401).headers(SECURITY_HEADERS).send({ error: 'invalid_team_token' });
      return undefined;
    }
    return { teamId: parsedTeamId.data, token, entry };
  };

  app.get('/join', (_request, reply) => reply.code(302).header('location', 'join/').send());
  app.get('/join/', (request, reply) =>
    sendAsset(
      reply,
      'text/html; charset=utf-8',
      options.accounts && (request.query as { legacy?: string }).legacy !== '1'
        ? accountPortalHtml(options.publicUrl)
        : JOIN_PORTAL_HTML
    )
  );
  app.get('/join/account.js', (_request, reply) =>
    sendAsset(reply, 'text/javascript; charset=utf-8', ACCOUNT_PORTAL_JS)
  );
  app.get('/join/account.css', (_request, reply) =>
    sendAsset(reply, 'text/css; charset=utf-8', ACCOUNT_PORTAL_CSS)
  );
  app.get('/join/privacy', (_request, reply) =>
    sendAsset(reply, 'text/html; charset=utf-8', accountPrivacyHtml(options.publicUrl))
  );
  app.get('/join/app.js', (_request, reply) =>
    sendAsset(reply, 'text/javascript; charset=utf-8', JOIN_PORTAL_APP_JS)
  );
  app.get('/join/app.css', (_request, reply) =>
    sendAsset(reply, 'text/css; charset=utf-8', JOIN_PORTAL_CSS)
  );

  app.get('/join/api/teams', (_request, reply) =>
    reply
      .headers(SECURITY_HEADERS)
      .header('cache-control', 'no-store')
      .send({
        teams: teamDirectory.listPublic().map(publicTeam),
        ...catalog,
      })
  );

  app.post('/join/api/teams/:teamId/verify', (request, reply) => {
    const authorized = authorize(request, reply);
    if (authorized === undefined) return reply;
    return reply
      .headers(SECURITY_HEADERS)
      .header('cache-control', 'no-store')
      .send({
        team: publicTeam(authorized.entry),
        workerStreamUrl,
        ...catalog,
        ...(options.repository === undefined ? {} : { repository: options.repository }),
      });
  });

  app.post('/join/api/teams/:teamId/installer', (request, reply) => {
    if (options.installer === undefined || catalog.installerRuntimes.length === 0) {
      return reply.code(503).headers(SECURITY_HEADERS).send({ error: 'installer_not_configured' });
    }
    const authorized = authorize(request, reply);
    if (authorized === undefined) return reply;
    const input =
      typeof request.body === 'object' && request.body !== null
        ? (request.body as { platform?: unknown; runtime?: unknown })
        : {};
    return sendTeamInstaller(
      reply,
      options.installer,
      input.platform,
      {
        relayUrl: workerStreamUrl,
        token: authorized.token,
        teamId: authorized.teamId,
      },
      input.runtime
    );
  });
};
