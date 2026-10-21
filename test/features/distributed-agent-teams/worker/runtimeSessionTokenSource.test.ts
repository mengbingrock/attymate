import {
  buildRestrictedRuntimeMcpConfig,
  createRuntimeSessionTokenSource,
} from '@claude-teams/agent-teams-worker';
import { describe, expect, it } from 'vitest';

describe('runtime session token source', () => {
  it('returns the environment token when no token file is configured', () => {
    expect(createRuntimeSessionTokenSource({ token: 'env-token' })).toBe('env-token');
    expect(() => createRuntimeSessionTokenSource({})).toThrow(/is required/);
  });

  it('reads the current token from the file on every call and falls back to the env token', () => {
    const contents = new Map<string, string>([['/w/runtime-session.token', 'first\n']]);
    const source = createRuntimeSessionTokenSource({
      token: 'env-token',
      tokenFile: '/w/runtime-session.token',
      readFile: (path) => {
        const value = contents.get(path);
        if (value === undefined) throw new Error('ENOENT');
        return value;
      },
    });
    expect(typeof source).toBe('function');
    const read = source as () => string;
    expect(read()).toBe('first');
    contents.set('/w/runtime-session.token', 'rotated');
    expect(read()).toBe('rotated');
    contents.delete('/w/runtime-session.token');
    expect(read()).toBe('env-token');
  });

  it('fails closed when the file is unreadable and no env token exists', () => {
    const source = createRuntimeSessionTokenSource({
      tokenFile: '/w/missing.token',
      readFile: () => {
        throw new Error('ENOENT');
      },
    }) as () => string;
    expect(() => source()).toThrow(/empty or unreadable/);
  });

  it('exposes the token file to the bridge only when the launch spec has one', () => {
    const withFile = buildRestrictedRuntimeMcpConfig(
      { command: 'node', args: ['bridge.js'], tokenFile: '/w/runtime-session.token' },
      'secret',
      []
    ) as { mcp_servers: Record<string, { env: Record<string, string> }> };
    const server = withFile.mcp_servers['agent-teams-runtime']!;
    expect(server.env.AGENT_TEAMS_RUNTIME_SESSION_TOKEN).toBe('secret');
    expect(server.env.AGENT_TEAMS_RUNTIME_SESSION_TOKEN_FILE).toBe('/w/runtime-session.token');
    const without = buildRestrictedRuntimeMcpConfig(
      { command: 'node', args: ['bridge.js'] },
      'secret',
      []
    ) as { mcp_servers: Record<string, { env: Record<string, string> }> };
    expect(without.mcp_servers['agent-teams-runtime']!.env).not.toHaveProperty(
      'AGENT_TEAMS_RUNTIME_SESSION_TOKEN_FILE'
    );
  });
});
