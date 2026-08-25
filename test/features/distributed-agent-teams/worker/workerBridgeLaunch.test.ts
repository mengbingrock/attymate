// @vitest-environment node

import { resolveWorkerBridgeLaunch } from '@claude-teams/agent-teams-worker';
import { describe, expect, it } from 'vitest';

describe('resolveWorkerBridgeLaunch', () => {
  const parentUrl = 'file:///worker/src/cli.ts';

  it('launches the packaged JavaScript bridge directly when present', () => {
    expect(
      resolveWorkerBridgeLaunch(parentUrl, 'runtimeMcpCli', {
        fileExists: (path) => path.endsWith('.js'),
        nodePath: '/usr/bin/node',
        nodeExecArgv: ['--import', 'tsx-loader'],
      })
    ).toEqual({
      command: '/usr/bin/node',
      args: ['/worker/src/runtimeMcpCli.js'],
      entryPath: '/worker/src/runtimeMcpCli.js',
    });
  });

  it('inherits the active TypeScript loader for a source-mode bridge', () => {
    expect(
      resolveWorkerBridgeLaunch(parentUrl, 'runtimeMcpCli', {
        fileExists: (path) => path.endsWith('.ts'),
        nodePath: '/usr/bin/node',
        nodeExecArgv: ['--require', '/tsx/preflight.cjs', '--import', 'file:///tsx/loader.mjs'],
      })
    ).toEqual({
      command: '/usr/bin/node',
      args: [
        '--require',
        '/tsx/preflight.cjs',
        '--import',
        'file:///tsx/loader.mjs',
        '/worker/src/runtimeMcpCli.ts',
      ],
      entryPath: '/worker/src/runtimeMcpCli.ts',
    });
  });
});
