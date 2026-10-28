// @vitest-environment node
import { checkDesktopCompatibility } from '../../../../packages/agent-teams-worker/src/desktopCompatibility';

import type { WorkerCodexAppServerSession } from '../../../../packages/agent-teams-worker/src/codexAppServerClient';

it.each([
  { requirements: null },
  { requirements: { application: { network: { enabled: true, domains: {} } } } },
  { requirements: { application: null } },
  { requirements: { application: { network: null } } },
  {
    requirements: {
      application: {
        network: { enabled: true, domains: { 'example.com': 'allow', localhost: 'deny' } },
      },
    },
  },
])('accepts explicit application policy without changing it: %j', async (response) => {
  const request = vi.fn(async () => response);
  const close = vi.fn(async () => undefined);
  const factory = {
    open: async () => ({ request, close }) as unknown as WorkerCodexAppServerSession,
  };
  await checkDesktopCompatibility(factory);
  expect(request).toHaveBeenCalledExactlyOnceWith('configRequirements/read', {}, 15_000);
  expect(close).toHaveBeenCalledOnce();
});

it.each([
  {},
  { requirements: {} },
  { requirements: { application: { network: { enabled: true, domains: { '*': 'allow' } } } } },
  {
    requirements: {
      application: { network: { enabled: true, domains: { 'example.com': 'prompt' } } },
    },
  },
])('refuses unavailable or malformed desktop policy: %j', async (response) => {
  const close = vi.fn(async () => undefined);
  const factory = {
    open: async () =>
      ({ request: async () => response, close }) as unknown as WorkerCodexAppServerSession,
  };
  await expect(checkDesktopCompatibility(factory)).rejects.toThrow(
    'application network requirements'
  );
  expect(close).toHaveBeenCalledOnce();
});

it('closes the connection and explains recovery when the server lacks the RPC', async () => {
  const close = vi.fn(async () => undefined);
  const factory = {
    open: async () =>
      ({
        request: async () => {
          throw new Error('unknown method');
        },
        close,
      }) as unknown as WorkerCodexAppServerSession,
  };
  await expect(checkDesktopCompatibility(factory)).rejects.toThrow('stop/start this installation');
  expect(close).toHaveBeenCalledOnce();
});
