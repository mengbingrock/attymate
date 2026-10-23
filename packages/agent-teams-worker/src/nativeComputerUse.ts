import { access, readFile, readdir } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

import {
  runtimeConnectionPolicySchema,
  type CodexRuntimeConnectionPolicy,
} from './codexRuntimeConnections';

export const nativeComputerUseEnvironment = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(env).filter(
      ([name]) => !name.startsWith('BROWSER_USE_ACCESS_') && name !== 'CODEX_THREAD_ID'
    )
  );

/** Use the installed official transport, without borrowing another chat's access identity. */
export const withNativeComputerUse = async (
  codexHome: string,
  policy?: CodexRuntimeConnectionPolicy
): Promise<CodexRuntimeConnectionPolicy> => {
  if (policy?.mcpServers.cua_repl !== undefined) return policy;
  const root = join(codexHome, 'plugins', 'cache', 'openai-bundled', 'unified-computer-use');
  const versions = (await readdir(root, { withFileTypes: true }))
    .filter((v) => v.isDirectory())
    .map((v) => v.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  if (!versions.length)
    throw new Error('Install and enable official Computer Use in the local Codex app first.');
  const manifest = JSON.parse(await readFile(join(root, versions[0], '.mcp.json'), 'utf8')) as {
    mcpServers?: { cua_repl?: { command?: string; args?: string[]; env?: Record<string, string> } };
  };
  const server = manifest.mcpServers?.cua_repl;
  if (!server?.command || !Array.isArray(server.args))
    throw new Error('The installed Computer Use manifest has no supported local MCP transport.');
  const env = Object.fromEntries(
    Object.entries(server.env ?? {}).filter(
      ([name]) => !name.startsWith('BROWSER_USE_ACCESS_') && name !== 'CODEX_THREAD_ID'
    )
  );
  // --computer-use explicitly selects both official services. Desktop-generated
  // manifests can describe a browser-only chat; configure our own MCP launch,
  // preserving the installed manifest and all native permission checks.
  const surfaces = new Set((env.CUA_REPL_ENABLED_SURFACES ?? '').split(',').filter(Boolean));
  if (!surfaces.has('computer')) {
    const moduleDirs = (env.NODE_REPL_NODE_MODULE_DIRS ?? '').split(delimiter).filter(Boolean);
    let installed = false;
    for (const dir of moduleDirs) {
      try {
        await access(join(dir, '@oai', 'sky', 'package.json'));
        installed = true;
        break;
      } catch {
        /* Try the next official runtime module directory. */
      }
    }
    if (!installed)
      throw new Error(
        'The installed official Computer Use service is missing. Enable it in the local Codex app first.'
      );
    const services: unknown = env.NODE_REPL_TRUSTED_SERVICES
      ? JSON.parse(env.NODE_REPL_TRUSTED_SERVICES)
      : {};
    if (!services || typeof services !== 'object' || Array.isArray(services))
      throw new Error('The official Computer Use service configuration is invalid.');
    env.CUA_REPL_ENABLED_SURFACES = [...new Set([...surfaces, 'browser', 'computer'])].join(',');
    env.NODE_REPL_TRUSTED_SERVICES = JSON.stringify({
      browser: '@oai/browser-desktop/service',
      sky: '@oai/sky/service',
      ...services,
    });
  }
  return runtimeConnectionPolicySchema.parse({
    ...policy,
    mcpServers: {
      ...policy?.mcpServers,
      cua_repl: {
        launch: { command: server.command, args: server.args },
        env,
        enabledTools: ['js', 'js_reset', 'turn_ended'],
        approvalMode: 'prompt',
      },
    },
  });
};
