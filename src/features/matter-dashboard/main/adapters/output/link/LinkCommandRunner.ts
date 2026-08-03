import { execFile } from 'node:child_process';

import { buildEnrichedEnv } from '@main/utils/cliEnv';

const LINK_COMMAND_TIMEOUT_MS = 30_000;
const LINK_COMMAND_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

export interface LinkCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface LinkCommandRunner {
  run(args: readonly string[]): Promise<LinkCommandResult>;
}

export interface LinkCommandInvocation {
  command: string;
  prefixArgs: readonly string[];
  displayName: string;
}

function readEnvValue(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

/**
 * Resolve Link without a shell. Production/global installs use `lnk`; local
 * AttyMate development can point at a Link source checkout and invoke its
 * non-executable `link.py` through Python.
 */
export function resolveLinkCommandInvocation(
  env: NodeJS.ProcessEnv = process.env
): LinkCommandInvocation {
  const command = readEnvValue(env, 'AGENT_TEAMS_LINK_COMMAND');
  if (command) {
    return { command, prefixArgs: [], displayName: command };
  }

  const script = readEnvValue(env, 'AGENT_TEAMS_LINK_SCRIPT');
  if (script) {
    const python = readEnvValue(env, 'AGENT_TEAMS_LINK_PYTHON') ?? 'python3';
    return {
      command: python,
      prefixArgs: [script],
      displayName: `${python} ${script}`,
    };
  }

  return { command: 'lnk', prefixArgs: [], displayName: 'lnk' };
}

export class LinkCommandUnavailableError extends Error {
  constructor(command: string) {
    super(`Link command is unavailable: ${command}`);
    this.name = 'LinkCommandUnavailableError';
  }
}

export class NodeLinkCommandRunner implements LinkCommandRunner {
  constructor(
    private readonly invocation: LinkCommandInvocation = resolveLinkCommandInvocation()
  ) {}

  run(args: readonly string[]): Promise<LinkCommandResult> {
    return new Promise((resolve, reject) => {
      execFile(
        this.invocation.command,
        [...this.invocation.prefixArgs, ...args],
        {
          env: buildEnrichedEnv(this.invocation.command),
          timeout: LINK_COMMAND_TIMEOUT_MS,
          maxBuffer: LINK_COMMAND_MAX_BUFFER_BYTES,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          const output = String(stdout);
          const errorOutput = String(stderr);
          if (!error) {
            resolve({ exitCode: 0, stdout: output, stderr: errorOutput });
            return;
          }

          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            reject(new LinkCommandUnavailableError(this.invocation.displayName));
            return;
          }
          if (error.killed) {
            reject(new Error('Link command timed out.'));
            return;
          }

          resolve({
            exitCode: typeof code === 'number' ? code : 1,
            stdout: output,
            stderr: errorOutput || error.message,
          });
        }
      );
    });
  }
}
