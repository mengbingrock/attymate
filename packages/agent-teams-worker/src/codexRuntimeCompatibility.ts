import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { WorkerCodexAppServerSessionFactory } from './codexAppServerClient';
import { readConfiguredMcpServerNames } from './codexRuntimeMcpProfile';

const exec = promisify(execFile);
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Model-free startup probe. Actual turn, approval, and MCP behavior needs live signoff. */
export const probeStockCodexCompatibility = async (input: {
  binaryPath: string;
  env: NodeJS.ProcessEnv;
  factory: WorkerCodexAppServerSessionFactory;
  shared: boolean;
  expectedVersion?: string;
}): Promise<{
  checks: readonly string[];
  serverVersion?: string;
  serverIdentity: 'local-process' | 'version-matched' | 'unverified-endpoint';
}> => {
  const checks: string[] = ['version'];
  for (const [args, required, label] of [
    [['app-server', '--help'], '--listen', 'app-server listener'],
    [['agents', '--help'], '--remote', 'remote terminal client'],
  ] as const) {
    const result = await exec(input.binaryPath, [...args], {
      env: input.env,
      timeout: 15_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    });
    if (!result.stdout.includes(required))
      throw new Error(`Stock Codex is incompatible: missing ${label} (${required})`);
    checks.push(label);
  }
  const workspace = await mkdtemp(join(tmpdir(), 'agent-teams-compat-'));
  const session = await input.factory.open().catch(async (error) => {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  });
  let threadId: string | undefined;
  try {
    checks.push('initialize');
    const serverVersion =
      /(?:codex[^\s/]*|agent_teams_worker)\/(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i.exec(
        session.serverInfo?.userAgent ?? ''
      )?.[1];
    if (serverVersion && input.expectedVersion && serverVersion !== input.expectedVersion) {
      throw new Error(
        `Connected App Server version ${serverVersion} differs from selected Codex ${input.expectedVersion}; check the explicit endpoint`
      );
    }
    const config = await session.request('config/read', { includeLayers: false }, 15_000);
    checks.push('config/read');
    const started = await session.request(
      'thread/start',
      {
        cwd: workspace,
        ephemeral: true,
        approvalPolicy: 'on-request',
        sandbox: 'read-only',
        config: {
          features: { apps: false, plugins: false, remote_plugin: false },
          mcp_servers: Object.fromEntries(
            readConfiguredMcpServerNames(config).map((name) => [name, { enabled: false }])
          ),
        },
      },
      20_000
    );
    const id = record(record(started).thread).id;
    if (typeof id !== 'string' || !id)
      throw new Error('Stock Codex thread/start returned no thread ID');
    threadId = id;
    checks.push('thread/start');
    const read = await session.request('thread/read', { threadId }, 15_000);
    if (record(record(read).thread).id !== threadId)
      throw new Error('Stock Codex thread/read returned a different thread');
    checks.push('thread/read');
    const inventory = record(
      await session.request(
        'mcpServerStatus/list',
        { threadId, limit: 100, detail: 'full' },
        15_000
      )
    );
    if (
      !Array.isArray(inventory.data) ||
      inventory.nextCursor != null ||
      inventory.data.some((value) => {
        const server = record(value);
        return (
          typeof server.name !== 'string' ||
          server.tools === null ||
          typeof server.tools !== 'object' ||
          Array.isArray(server.tools) ||
          Object.keys(server.tools).length > 0 ||
          [server.resources, server.resourceTemplates].some(
            (items) => items !== undefined && (!Array.isArray(items) || items.length > 0)
          )
        );
      })
    )
      throw new Error('Stock Codex probe thread inherited unsafe MCP capabilities');
    checks.push('restricted MCP inventory');
    // Ephemeral threads cannot always resume. A persistent resume is covered by the live smoke.
    if (input.shared) checks.push('shared-endpoint connection');
    return {
      checks,
      ...(serverVersion ? { serverVersion } : {}),
      serverIdentity: !input.shared
        ? 'local-process'
        : serverVersion && input.expectedVersion
          ? 'version-matched'
          : 'unverified-endpoint',
    };
  } catch (error) {
    throw new Error(
      `Stock Codex compatibility check failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    if (threadId)
      await session.request('thread/unsubscribe', { threadId }, 3_000).catch(() => undefined);
    await session.close();
    await rm(workspace, { recursive: true, force: true });
  }
};
