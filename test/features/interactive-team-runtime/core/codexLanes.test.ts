// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildCodexLaneArgs,
  CODEX_AGENT_TEAMS_MCP_SERVER_NAME,
} from '@features/interactive-team-runtime/core/domain/codexLaneArgs';
import { detectCodexPaneState } from '@features/interactive-team-runtime/core/domain/codexPaneState';
import { parseRuntimeBinding } from '@features/interactive-team-runtime/core/domain/runtimeBinding';

const MCP_SERVER = {
  command: '/repo/node_modules/.bin/tsx',
  args: ['/repo/mcp-server/src/index.ts'],
  env: {
    AGENT_TEAMS_MCP_CLAUDE_DIR: '/Users/x/.claude',
    CLAUDE_TEAM_CONTROL_URL: 'http://127.0.0.1:3456',
  },
};

describe('buildCodexLaneArgs', () => {
  it('emits stock -c overrides for the MCP server, trust, model, and effort', () => {
    const args = buildCodexLaneArgs({
      mcpServer: MCP_SERVER,
      cwd: '/tmp/my project',
      model: 'gpt-5.2',
      reasoningEffort: 'high',
    });
    const key = `mcp_servers.${CODEX_AGENT_TEAMS_MCP_SERVER_NAME}`;
    const joined = args.join(' ');
    expect(joined).toContain(`${key}.command="/repo/node_modules/.bin/tsx"`);
    expect(joined).toContain(`${key}.args=["/repo/mcp-server/src/index.ts"]`);
    expect(joined).toContain(`${key}.env.AGENT_TEAMS_MCP_CLAUDE_DIR="/Users/x/.claude"`);
    expect(joined).toContain(`${key}.env.CLAUDE_TEAM_CONTROL_URL="http://127.0.0.1:3456"`);
    expect(joined).toContain(`${key}.startup_timeout_sec=30`);
    // Quoted-key TOML path for the trusted project (cwd contains a space).
    expect(joined).toContain('projects."/tmp/my project".trust_level="trusted"');
    expect(args).toContain('-m');
    expect(args).toContain('gpt-5.2');
    expect(joined).toContain('model_reasoning_effort="high"');
    // Sandbox bypass is the default.
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
    // No fork-only settings payloads.
    expect(args).not.toContain('--settings');
  });

  it('omits bypass flag when sandboxed and appends extra overrides', () => {
    const args = buildCodexLaneArgs({
      mcpServer: MCP_SERVER,
      cwd: '/tmp/p',
      bypassSandbox: false,
      forcedLoginMethod: 'chatgpt',
      extraConfigOverrides: ['service_tier="fast"'],
    });
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args.join(' ')).toContain('forced_login_method="chatgpt"');
    expect(args.join(' ')).toContain('service_tier="fast"');
  });
});

describe('detectCodexPaneState', () => {
  // Fixtures captured live from codex-cli 0.145.0.
  it('classifies the trust dialog', () => {
    const tail = [
      '> You are in /tmp/spike',
      '  Do you trust the contents of this directory? Working with untrusted contents comes with higher risk of prompt injection.',
      '› 1. Yes, continue',
      '  2. No, quit',
      '  Press enter to continue',
    ].join('\n');
    expect(detectCodexPaneState(tail)).toBe('trust-dialog');
  });

  it('classifies the idle composer as ready', () => {
    const tail = [
      '╭────────────────────────────────╮',
      '│ >_ OpenAI Codex (v0.145.0)     │',
      '╰────────────────────────────────╯',
      '› Summarize recent commits',
      '  gpt-5.6-sol low · /private/tmp/spike',
    ].join('\n');
    expect(detectCodexPaneState(tail)).toBe('ready');
  });

  it('classifies login-required and unknown states', () => {
    expect(detectCodexPaneState('Sign in with ChatGPT to continue')).toBe('login-required');
    expect(detectCodexPaneState('random shell output\n$')).toBe('unknown');
  });
});

describe('parseRuntimeBinding', () => {
  it('reads v1 bindings as claude-interactive', () => {
    const binding = parseRuntimeBinding(
      JSON.stringify({
        version: 1,
        teamName: 't',
        runId: 'r',
        tmuxSessionName: 'agteams-t-r',
        leadSessionId: 'abc',
        sessionTeamName: 'session-abc',
        leadPaneId: '%1',
        launchedAt: '2026-01-01T00:00:00Z',
      })
    );
    expect(binding?.runtime).toBe('claude-interactive');
    expect(binding?.lanes).toEqual([]);
  });

  it('reads v2 codex-lanes bindings with lanes', () => {
    const binding = parseRuntimeBinding(
      JSON.stringify({
        version: 2,
        runtime: 'codex-lanes',
        teamName: 't',
        runId: 'r',
        tmuxSessionName: 'agteams-t-r',
        leadSessionId: null,
        sessionTeamName: null,
        leadPaneId: '%1',
        lanes: [
          { memberName: 'team-lead', isLead: true, paneId: '%1', windowIndex: 0 },
          { memberName: 'alice', isLead: false, paneId: '%2', windowIndex: 1 },
        ],
        launchedAt: '2026-01-01T00:00:00Z',
      })
    );
    expect(binding?.runtime).toBe('codex-lanes');
    expect(binding?.lanes).toHaveLength(2);
    expect(binding?.lanes[1]).toEqual({
      memberName: 'alice',
      isLead: false,
      paneId: '%2',
      windowIndex: 1,
    });
  });

  it('rejects malformed payloads', () => {
    expect(parseRuntimeBinding('not json')).toBeNull();
    expect(parseRuntimeBinding(JSON.stringify({ version: 3, tmuxSessionName: 'x' }))).toBeNull();
  });
});
