// @vitest-environment node
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { probeStockCodexCompatibility } from '../../../../packages/agent-teams-worker/src/codexRuntimeCompatibility';

import type { WorkerCodexAppServerSession } from '../../../../packages/agent-teams-worker/src/codexAppServerClient';

describe.skipIf(process.platform === 'win32')('stock runtime startup compatibility', () => {
  let root: string;
  let binaryPath: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agt-compat-'));
    binaryPath = join(root, 'codex');
    await writeFile(binaryPath, '#!/bin/sh\nprintf "%s\\n" "--listen --remote"\n');
    await chmod(binaryPath, 0o700);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const factory = (
    threadId: unknown = 'thread-test',
    inventory: unknown = { data: [], nextCursor: null }
  ) => {
    const request = vi.fn(async (method: string) => {
      if (method === 'config/read') return { config: { mcp_servers: { personal: {} } } };
      if (method === 'mcpServerStatus/list') return inventory;
      return { thread: { id: threadId } };
    });
    const close = vi.fn(async () => undefined);
    const open = vi.fn(async () => ({ request, close }) as unknown as WorkerCodexAppServerSession);
    return { open, request, close };
  };

  it('verifies the actual endpoint and disables inherited MCP in the disposable probe thread', async () => {
    const runtime = factory();
    const { checks, serverIdentity } = await probeStockCodexCompatibility({
      binaryPath,
      env: process.env,
      factory: runtime,
      shared: true,
    });
    expect(checks).toContain('thread/read');
    expect(checks).toContain('restricted MCP inventory');
    expect(checks).toContain('shared-endpoint connection');
    expect(serverIdentity).toBe('unverified-endpoint');
    expect(runtime.request).toHaveBeenCalledWith(
      'thread/start',
      expect.objectContaining({
        ephemeral: true,
        sandbox: 'read-only',
        config: expect.objectContaining({ mcp_servers: { personal: { enabled: false } } }),
      }),
      20_000
    );
    expect(runtime.request.mock.calls.map(([method]) => method)).not.toContain('turn/start');
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it('rejects an incompatible CLI before opening a runtime connection', async () => {
    await writeFile(binaryPath, '#!/bin/sh\nprintf "%s\\n" "old CLI"\n');
    const runtime = factory();
    await expect(
      probeStockCodexCompatibility({ binaryPath, env: process.env, factory: runtime, shared: true })
    ).rejects.toThrow('missing app-server listener');
    expect(runtime.open).not.toHaveBeenCalled();
  });

  it('refuses a server that exposes owner tools despite the restricted probe config', async () => {
    const runtime = factory('thread-test', {
      data: [{ name: 'personal', tools: { owner_control: {} } }],
      nextCursor: null,
    });
    await expect(
      probeStockCodexCompatibility({ binaryPath, env: process.env, factory: runtime, shared: true })
    ).rejects.toThrow('unsafe MCP capabilities');
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it('closes a server connection when its protocol response is incompatible', async () => {
    const runtime = factory(null);
    await expect(
      probeStockCodexCompatibility({
        binaryPath,
        env: process.env,
        factory: runtime,
        shared: false,
      })
    ).rejects.toThrow('returned no thread ID');
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it('rejects a socket whose reported server version differs from the selected client', async () => {
    const runtime = factory();
    runtime.open.mockResolvedValue({
      request: runtime.request,
      close: runtime.close,
      serverInfo: { userAgent: 'codex_cli_rs/0.145.0' },
    } as unknown as WorkerCodexAppServerSession);
    await expect(
      probeStockCodexCompatibility({
        binaryPath,
        env: process.env,
        factory: runtime,
        shared: true,
        expectedVersion: '0.164.0',
      })
    ).rejects.toThrow('differs from selected Codex');
    expect(runtime.request).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledOnce();
  });
});
