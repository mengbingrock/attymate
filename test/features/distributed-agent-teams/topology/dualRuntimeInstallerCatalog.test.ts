// @vitest-environment node
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  installerCatalog,
  resolveInstallerSelection,
  sendTeamInstaller,
} from '../../../../packages/agent-teams-relay/src/relayJoinPortal';

const installer = {
  template: 'RUNTIME_KIND="__RUNTIME_KIND__"\n__PAYLOAD_BELOW__\n',
  workerBundleTgz: Buffer.from('legacy-fork'),
  platformBundles: { 'darwin-x64': Buffer.from('fork-mac') },
  stock: {
    template: 'RUNTIME_KIND="__RUNTIME_KIND__"\n__PAYLOAD_BELOW__\n',
    platformBundles: { 'linux-x64': Buffer.from('stock-linux') },
  },
};

describe('dual runtime installer catalog', () => {
  it('preserves legacy fork fields and resolves only the explicitly selected distribution', () => {
    const catalog = installerCatalog(installer);
    expect(catalog.installerAvailable).toBe(true);
    expect(catalog.installerPlatforms.map(({ id }) => id)).toEqual(['darwin-x64']);
    expect(catalog.installerRuntimes.map(({ id }) => id)).toEqual(['fork', 'stock']);
    expect(resolveInstallerSelection(installer, undefined)?.bundle.toString()).toBe('legacy-fork');
    expect(resolveInstallerSelection(installer, 'darwin-x64')?.runtime).toBe('fork');
    expect(resolveInstallerSelection(installer, 'linux-x64', 'stock')?.bundle.toString()).toBe(
      'stock-linux'
    );
    expect(resolveInstallerSelection(installer, 'darwin-x64', 'stock')).toBeUndefined();
    expect(resolveInstallerSelection(installer, 'linux-x64', 'fork')).toBeUndefined();
    expect(resolveInstallerSelection(installer, 'darwin-x64', 'unknown')).toBeUndefined();
    expect(resolveInstallerSelection(installer, undefined, 'stock')).toBeUndefined();
  });

  it('publishes stock-only availability without inventing a fork download', () => {
    const stockOnly = { template: '', stock: installer.stock };
    const catalog = installerCatalog(stockOnly);
    expect(catalog.installerAvailable).toBe(false);
    expect(catalog.installerPlatforms).toEqual([]);
    expect(catalog.installerRuntimes.map(({ id }) => id)).toEqual(['stock']);
    expect(resolveInstallerSelection(stockOnly, 'linux-x64')).toBeUndefined();
    expect(resolveInstallerSelection(stockOnly, 'linux-x64', 'stock')).toBeDefined();
  });

  it('does not advertise Windows artifacts without the corresponding Windows template', () => {
    const catalog = installerCatalog({
      ...installer,
      stock: { ...installer.stock, platformBundles: { 'win32-x64': Buffer.from('stock-windows') } },
    });
    expect(catalog.installerRuntimes.map(({ id }) => id)).toEqual(['fork']);
  });

  it('refuses a template explicitly built for another runtime', () => {
    const mismatched = {
      ...installer,
      stock: { ...installer.stock, template: 'RUNTIME_KIND="fork"\n' },
    };
    expect(resolveInstallerSelection(mismatched, 'linux-x64', 'stock')).toBeUndefined();
    expect(installerCatalog(mismatched).installerRuntimes.map(({ id }) => id)).toEqual(['fork']);
  });

  it('renders runtime-specific artifacts and retains filenames for legacy requests', async () => {
    const app = Fastify();
    app.post('/download', (request, reply) => {
      const input = request.body as { platform?: unknown; runtime?: unknown };
      return sendTeamInstaller(
        reply,
        installer,
        input.platform,
        {
          relayUrl: 'wss://relay.example/v2/worker-stream',
          token: 'test-token',
          teamId: '40000000-0000-4000-8000-000000000001',
        },
        input.runtime
      );
    });
    try {
      const legacy = await app.inject({ method: 'POST', url: '/download', payload: {} });
      expect(legacy.statusCode).toBe(200);
      expect(legacy.headers['content-disposition']).toContain('agent-teams-join-40000000.sh');
      expect(legacy.body).toContain('RUNTIME_KIND="fork"');
      const stock = await app.inject({
        method: 'POST',
        url: '/download',
        payload: { platform: 'linux-x64', runtime: 'stock' },
      });
      expect(stock.statusCode).toBe(200);
      expect(stock.headers['content-disposition']).toContain('-stock-linux-x64.sh');
      expect(stock.body).toContain('RUNTIME_KIND="stock"');
      expect(Number(stock.headers['content-length'])).toBe(Buffer.byteLength(stock.body));
      expect(Buffer.from(stock.body.split('__PAYLOAD_BELOW__\n')[1]!, 'base64').toString()).toBe(
        'stock-linux'
      );
      const missing = await app.inject({
        method: 'POST',
        url: '/download',
        payload: { platform: 'darwin-x64', runtime: 'stock' },
      });
      expect(missing.statusCode).toBe(400);
      expect(missing.body).not.toContain('fork-mac');
    } finally {
      await app.close();
    }
  });
});
