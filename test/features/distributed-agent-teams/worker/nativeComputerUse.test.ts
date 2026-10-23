// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { withNativeComputerUse } from '../../../../packages/agent-teams-worker/src/nativeComputerUse';

describe('Official native Browser Use and Computer Use', () => {
  it('selects the installed desktop service for a browser-only manifest without rewriting it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'native-cua-browser-only-'));
    try {
      const root = join(home, 'plugins/cache/openai-bundled/unified-computer-use/26.10');
      const modules = join(home, 'official-runtime/node_modules');
      await mkdir(root, { recursive: true });
      const manifest = JSON.stringify({
        mcpServers: {
          cua_repl: {
            command: '/official/node',
            args: ['/official/cua-repl.mjs'],
            env: {
              CUA_REPL_ENABLED_SURFACES: 'browser',
              NODE_REPL_NODE_MODULE_DIRS: modules,
              NODE_REPL_TRUSTED_SERVICES: JSON.stringify({
                browser: '@oai/browser-desktop/service',
              }),
            },
          },
        },
      });
      await writeFile(join(root, '.mcp.json'), manifest);
      await expect(withNativeComputerUse(home)).rejects.toThrow('service is missing');
      await mkdir(join(modules, '@oai/sky'), { recursive: true });
      await writeFile(join(modules, '@oai/sky/package.json'), '{}');
      const selected = await withNativeComputerUse(home);
      expect(selected.mcpServers.cua_repl?.env?.CUA_REPL_ENABLED_SURFACES).toBe('browser,computer');
      expect(
        JSON.parse(selected.mcpServers.cua_repl?.env?.NODE_REPL_TRUSTED_SERVICES ?? '{}')
      ).toEqual({
        browser: '@oai/browser-desktop/service',
        sky: '@oai/sky/service',
      });
      expect(await readFile(join(root, '.mcp.json'), 'utf8')).toBe(manifest);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it('uses the installed transport and excludes another chat access identity', async () => {
    const home = await mkdtemp(join(tmpdir(), 'native-cua-'));
    try {
      const root = join(home, 'plugins/cache/openai-bundled/unified-computer-use');
      for (const version of ['26.2', '26.10']) {
        await mkdir(join(root, version), { recursive: true });
        await writeFile(
          join(root, version, '.mcp.json'),
          JSON.stringify({
            mcpServers: {
              cua_repl: {
                command: `/installed/${version}/node`,
                args: ['/official/cua-repl.mjs'],
                env: {
                  CUA_REPL_ENABLED_SURFACES: 'browser,computer',
                  BROWSER_USE_ACCESS_VERIFYING_IDENTITY: 'another-chat',
                  CODEX_THREAD_ID: 'another-chat',
                },
              },
            },
          })
        );
      }
      const selected = await withNativeComputerUse(home);
      expect(selected.mcpServers.cua_repl).toMatchObject({
        launch: { command: '/installed/26.10/node', args: ['/official/cua-repl.mjs'] },
        env: { CUA_REPL_ENABLED_SURFACES: 'browser,computer' },
        enabledTools: ['js', 'js_reset', 'turn_ended'],
        approvalMode: 'prompt',
      });
      expect(selected.mcpServers.cua_repl?.env).not.toHaveProperty('CODEX_THREAD_ID');
      expect(selected.mcpServers.cua_repl?.env).not.toHaveProperty(
        'BROWSER_USE_ACCESS_VERIFYING_IDENTITY'
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
