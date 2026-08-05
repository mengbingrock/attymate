import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { resetRuntimeProviderDirectoryCacheForTests } from '@features/runtime-provider-management/renderer/runtimeProviderDirectoryCache';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CodexAccountSnapshotDto } from '@features/codex-account/contracts';
import type { CodexRuntimeStatus } from '@features/codex-runtime-installer/contracts';

vi.mock('@renderer/components/ui/tabs', () => {
  let currentValue = '';
  let currentOnValueChange: ((value: string) => void) | null = null;

  return {
    Tabs: ({
      children,
      value,
      onValueChange,
    }: {
      children: React.ReactNode;
      value: string;
      onValueChange?: (value: string) => void;
    }) => {
      currentValue = value;
      currentOnValueChange = onValueChange ?? null;
      return React.createElement('div', { 'data-tabs-value': value }, children);
    },
    TabsList: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
      ({ children, ...props }, ref) => React.createElement('div', { ...props, ref }, children)
    ),
    TabsTrigger: ({
      children,
      value,
      disabled,
      onClick,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) =>
      React.createElement(
        'button',
        {
          ...props,
          type: 'button',
          role: 'tab',
          disabled,
          'data-state': currentValue === value ? 'active' : 'inactive',
          onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
            onClick?.(event);
            if (!disabled) {
              currentOnValueChange?.(value);
            }
          },
        },
        children
      ),
  };
});

const storeState = {
  cliStatus: null as unknown,
  cliStatusLoading: false,
  cliProviderStatusLoading: {} as Record<string, boolean>,
  cliProviderStatusByScope: {} as Record<string, unknown>,
  cliProviderStatusScopeRevision: 0,
  appConfig: { general: { multimodelEnabled: true } },
  fetchCliProviderStatus: vi.fn().mockResolvedValue(undefined),
  codexRuntimeStatus: null as CodexRuntimeStatus | null,
  codexRuntimeStatusLoading: false,
  codexRuntimeError: null as string | null,
  fetchCodexRuntimeStatus: vi.fn().mockResolvedValue(undefined),
  installCodexRuntime: vi.fn().mockResolvedValue(undefined),
};
const codexAccountHookState = {
  snapshot: null as CodexAccountSnapshotDto | null,
  loading: false,
  error: null as string | null,
  refresh: vi.fn(() => Promise.resolve(undefined)),
  startChatgptLogin: vi.fn(() => Promise.resolve(true)),
  cancelChatgptLogin: vi.fn(() => Promise.resolve(true)),
  logout: vi.fn(() => Promise.resolve(true)),
};

vi.mock('@renderer/store', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector(storeState),
}));

vi.mock('@features/codex-account/renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@features/codex-account/renderer')>();
  return {
    ...actual,
    useCodexAccountSnapshot: () => codexAccountHookState,
  };
});

const useVirtualizerMock = vi.fn(
  (options: { count: number }) =>
    ({
      getVirtualItems: () =>
        Array.from({ length: Math.min(options.count, 9) }, (_, index) => ({
          index,
          key: index,
          start: index * 92,
          size: 92,
        })),
      getTotalSize: () => options.count * 92,
      measureElement: () => undefined,
    }) as const
);

vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: (range: {
    startIndex: number;
    endIndex: number;
    overscan: number;
    count: number;
  }) => {
    const start = Math.max(range.startIndex - range.overscan, 0);
    const end = Math.min(range.endIndex + range.overscan, range.count - 1);
    return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
  },
  useVirtualizer: (options: { count: number }) => useVirtualizerMock(options),
}));

import { TeamModelSelector } from '@renderer/components/team/dialogs/TeamModelSelector';

describe('TeamModelSelector disabled Codex models', () => {
  afterEach(() => {
    resetRuntimeProviderDirectoryCacheForTests();
    document.body.innerHTML = '';
    Reflect.deleteProperty(window, 'electronAPI');
    storeState.cliStatus = null;
    storeState.cliStatusLoading = false;
    storeState.cliProviderStatusLoading = {};
    storeState.cliProviderStatusByScope = {};
    storeState.cliProviderStatusScopeRevision = 0;
    storeState.fetchCliProviderStatus.mockReset().mockResolvedValue(undefined);
    storeState.codexRuntimeStatus = null;
    storeState.codexRuntimeStatusLoading = false;
    storeState.codexRuntimeError = null;
    storeState.fetchCodexRuntimeStatus.mockClear();
    storeState.installCodexRuntime.mockClear();
    codexAccountHookState.snapshot = null;
    codexAccountHookState.loading = false;
    codexAccountHookState.error = null;
    codexAccountHookState.refresh.mockClear();
    codexAccountHookState.startChatgptLogin.mockClear();
    codexAccountHookState.cancelChatgptLogin.mockClear();
    codexAccountHookState.logout.mockClear();
    useVirtualizerMock.mockClear();
    vi.useRealTimers();
  });

  it('shows the Codex update notice and reuses the shared update dialog', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.codexRuntimeStatus = {
      installed: true,
      binaryPath: '/usr/local/bin/codex',
      version: 'codex-cli 0.139.0',
      latestVersion: '0.144.1',
      updateAvailable: true,
      source: 'path',
      state: 'ready',
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'codex',
          onProviderChange: () => undefined,
          value: '',
          onValueChange: () => undefined,
        })
      );
      await Promise.resolve();
    });

    const notice = host.querySelector('[data-testid="codex-runtime-update-notice"]');
    expect(notice?.textContent).toContain('Update available');
    const noticeButton = Array.from(notice?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('Update to v0.144.1')
    );

    await act(async () => {
      noticeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const updateButton = Array.from(dialog?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('Update to v0.144.1')
    );
    await act(async () => {
      updateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(storeState.installCodexRuntime).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it('explains static fallback models even when Codex is already current', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.codexRuntimeStatus = {
      installed: true,
      binaryPath: '/usr/local/bin/codex',
      version: 'codex-cli 0.144.1',
      latestVersion: '0.144.1',
      updateAvailable: false,
      source: 'path',
      state: 'ready',
    };
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'codex',
          models: ['gpt-5.6-sol'],
          modelCatalog: {
            schemaVersion: 1,
            providerId: 'codex',
            source: 'static-fallback',
            status: 'degraded',
            fetchedAt: '2026-07-10T00:00:00.000Z',
            staleAt: '2026-07-10T00:10:00.000Z',
            defaultModelId: 'gpt-5.6-sol',
            defaultLaunchModel: 'gpt-5.6-sol',
            models: [
              {
                id: 'gpt-5.6-sol',
                launchModel: 'gpt-5.6-sol',
                displayName: 'GPT-5.6-Sol',
                hidden: false,
                supportedReasoningEfforts: ['low', 'medium', 'high'],
                defaultReasoningEffort: 'low',
                inputModalities: ['text', 'image'],
                supportsPersonality: false,
                isDefault: true,
                upgrade: false,
                source: 'static-fallback',
                badgeLabel: '5.6-sol',
              },
            ],
            diagnostics: {
              configReadState: 'skipped',
              appServerState: 'degraded',
              message: 'model/list timed out',
              code: null,
            },
          },
          runtimeCapabilities: {
            modelCatalog: {
              dynamic: true,
              source: 'app-server',
            },
          },
        },
      ],
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'codex',
          onProviderChange: () => undefined,
          value: '',
          onValueChange: () => undefined,
        })
      );
      await Promise.resolve();
    });

    const notice = host.querySelector('[data-testid="codex-model-catalog-fallback-notice"]');
    expect(notice?.textContent).toContain('Live Codex models unavailable');
    expect(notice?.textContent).toContain('newly released models may be missing');
    expect(host.querySelector('[data-testid="codex-runtime-update-notice"]')).toBeNull();
    expect(host.textContent).toContain('5.6-Sol');

    await act(async () => root.unmount());
  });

  it('normalizes a stale disabled selection back to default', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onValueChange = vi.fn();

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'codex',
          onProviderChange: () => undefined,
          value: 'gpt-5.1-codex-mini',
          onValueChange,
        })
      );
      await Promise.resolve();
    });

    expect(onValueChange).toHaveBeenCalledWith('');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('normalizes a stale 5.3 Codex Spark selection back to default', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onValueChange = vi.fn();

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'codex',
          onProviderChange: () => undefined,
          value: 'gpt-5.3-codex-spark',
          onValueChange,
        })
      );
      await Promise.resolve();
    });

    expect(onValueChange).toHaveBeenCalledWith('');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('hides recommendation badges for Anthropic and Codex model tiles', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'codex',
          models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2'],
          modelVerificationState: 'idle',
          modelAvailability: [],
        },
      ],
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'anthropic',
          onProviderChange: () => undefined,
          value: '',
          onValueChange: () => undefined,
        })
      );
      await Promise.resolve();
    });

    const anthropicButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Opus 4.6')
    );
    expect(anthropicButton).toBeDefined();
    expect(anthropicButton?.textContent).not.toContain('Recommended');

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'codex',
          onProviderChange: () => undefined,
          value: '',
          onValueChange: () => undefined,
        })
      );
      await Promise.resolve();
    });

    const codexButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('5.2')
    );
    expect(codexButton).toBeDefined();
    expect(codexButton?.textContent).not.toContain('Recommended');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('does not synthesize a New ribbon without release metadata', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'anthropic',
          onProviderChange: () => undefined,
          value: 'opus',
          onValueChange: () => undefined,
        })
      );
      await Promise.resolve();
    });

    const opus48Button = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.trim().startsWith('Opus 4.8')
    );
    expect(opus48Button?.textContent).not.toContain('New');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('uses the runtime-reported Codex list and clears stale unsupported selections', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'codex',
          models: ['gpt-5.4', 'gpt-5.3-codex'],
        },
      ],
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onValueChange = vi.fn();

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'codex',
          onProviderChange: () => undefined,
          value: 'gpt-5.2-codex',
          onValueChange,
        })
      );
      await Promise.resolve();
    });

    expect(onValueChange).toHaveBeenCalledWith('');
    expect(host.textContent).toContain('5.4');
    expect(host.textContent).toContain('5.3 Codex');
    const disabledCodexButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('5.2 Codex')
    );
    expect(disabledCodexButton).not.toBeNull();
    expect(disabledCodexButton?.getAttribute('aria-disabled')).toBe('true');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('renders Anthropic-compatible catalog models instead of Claude fallback aliases', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const onValueChange = vi.fn();
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'anthropic',
          models: [],
          authMethod: 'auth_token',
          authenticated: true,
          supported: true,
          capabilities: {
            teamLaunch: true,
            oneShot: true,
          },
          connection: {
            supportsOAuth: true,
            supportsApiKey: true,
            configurableAuthModes: ['auto', 'oauth', 'api_key'],
            configuredAuthMode: 'auto',
            apiKeyConfigured: false,
            apiKeySource: null,
            apiKeySourceLabel: null,
            compatibleEndpoint: {
              enabled: true,
              baseUrl: 'http://localhost:1234',
              tokenConfigured: true,
              tokenSource: 'stored',
              tokenSourceLabel: 'Stored in app',
            },
          },
          modelCatalog: {
            schemaVersion: 1,
            providerId: 'anthropic',
            source: 'anthropic-compatible-api',
            status: 'ready',
            fetchedAt: '2026-05-21T00:00:00.000Z',
            staleAt: '2026-05-21T00:10:00.000Z',
            defaultModelId: 'openai/gpt-oss-20b',
            defaultLaunchModel: 'openai/gpt-oss-20b',
            models: [
              {
                id: 'openai/gpt-oss-20b',
                launchModel: 'openai/gpt-oss-20b',
                displayName: 'GPT OSS 20B',
                hidden: false,
                supportedReasoningEfforts: [],
                defaultReasoningEffort: null,
                inputModalities: ['text'],
                supportsPersonality: true,
                isDefault: true,
                upgrade: false,
                source: 'anthropic-compatible-api',
                badgeLabel: 'Local',
              },
            ],
            diagnostics: {
              configReadState: 'ready',
              appServerState: 'healthy',
            },
          },
        },
      ],
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'anthropic',
          onProviderChange: () => undefined,
          value: '',
          onValueChange,
        })
      );
      await Promise.resolve();
    });

    expect(host.textContent).toContain('GPT OSS 20B');
    expect(host.textContent).not.toContain('Opus 4.7');
    expect(
      host.querySelector('[data-testid="team-model-selector-anthropic-compatible-custom-model"]')
    ).toBeNull();
    const defaultModelButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Default')
    );
    expect(defaultModelButton?.getAttribute('aria-label')).toContain(
      'Anthropic-compatible endpoint default model'
    );
    expect(defaultModelButton?.getAttribute('aria-label')).toContain('openai/gpt-oss-20b');
    const localModelButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('GPT OSS 20B')
    );
    expect(localModelButton).toBeDefined();

    await act(async () => {
      localModelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(onValueChange).toHaveBeenCalledWith('openai/gpt-oss-20b');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('renders Anthropic-compatible custom model input for degraded catalogs', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const onValueChange = vi.fn();
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'anthropic',
          models: [],
          authMethod: 'auth_token',
          authenticated: true,
          supported: true,
          capabilities: {
            teamLaunch: true,
            oneShot: true,
          },
          connection: {
            supportsOAuth: true,
            supportsApiKey: true,
            configurableAuthModes: ['auto', 'oauth', 'api_key'],
            configuredAuthMode: 'auto',
            apiKeyConfigured: false,
            apiKeySource: null,
            apiKeySourceLabel: null,
            compatibleEndpoint: {
              enabled: true,
              baseUrl: 'http://localhost:1234',
              tokenConfigured: true,
              tokenSource: 'stored',
              tokenSourceLabel: 'Stored in app',
            },
          },
          modelCatalog: {
            schemaVersion: 1,
            providerId: 'anthropic',
            source: 'anthropic-compatible-api',
            status: 'degraded',
            fetchedAt: '2026-05-21T00:00:00.000Z',
            staleAt: '2026-05-21T00:10:00.000Z',
            defaultModelId: null,
            defaultLaunchModel: null,
            models: [],
            diagnostics: {
              configReadState: 'failed',
              appServerState: 'degraded',
              message: 'Local catalog unavailable',
            },
          },
        },
      ],
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'anthropic',
          onProviderChange: () => undefined,
          value: 'openai/gpt-oss-20b',
          onValueChange,
        })
      );
      await Promise.resolve();
    });

    const customInput = host.querySelector<HTMLInputElement>(
      '[data-testid="team-model-selector-anthropic-compatible-custom-model"]'
    );
    expect(customInput).toBeTruthy();
    expect(customInput?.value).toBe('openai/gpt-oss-20b');
    expect(host.textContent).toContain('Local catalog unavailable');

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setValue?.call(customInput, 'qwen/qwen3-coder');
      customInput?.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });

    expect(onValueChange).toHaveBeenCalledWith('qwen/qwen3-coder');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('constrains long runtime model lists so the selector scrolls', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'codex',
          models: [
            'gpt-5.4',
            'gpt-5.4-mini',
            'gpt-5.3-codex',
            'gpt-5.3-codex-spark',
            'gpt-5.2',
            'gpt-5.1-codex',
            'gpt-5.1-codex-mini',
            'gpt-5',
            'gpt-4.1',
          ],
        },
      ],
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'codex',
          onProviderChange: () => undefined,
          value: '',
          onValueChange: () => undefined,
        })
      );
      await Promise.resolve();
    });

    const modelGrid = host.querySelector<HTMLElement>(
      '[data-testid="team-model-selector-model-grid"]'
    );

    expect(modelGrid).toBeTruthy();
    expect(modelGrid?.style.maxHeight).toBe('');
    expect(modelGrid?.style.height).toBe('');
    expect(modelGrid?.className).toContain('h-[clamp(320px,calc(100vh-300px),520px)]');
    expect(modelGrid?.className).toContain('-mx-4');
    expect(modelGrid?.className).toContain('w-[calc(100%+2rem)]');
    expect(modelGrid?.className).toContain('flex-none');
    expect(modelGrid?.className).toContain('overflow-y-auto');
    const searchInput = host.querySelector<HTMLInputElement>(
      '[data-testid="team-model-selector-model-search"]'
    );
    expect(searchInput).toBeTruthy();

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setValue?.call(searchInput, '5.3');
      searchInput?.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });

    expect(host.textContent).toContain('5.3 Codex');
    expect(host.textContent).not.toContain('5.4 Mini');
    const clearSearch = host.querySelector<HTMLButtonElement>(
      '[data-testid="team-model-selector-model-search-clear"]'
    );
    expect(clearSearch).not.toBeNull();

    await act(async () => {
      clearSearch?.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('5.4 Mini');
    expect(host.querySelector('[data-testid="team-model-selector-model-search-clear"]')).toBeNull();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('keeps the runtime-reported Codex model list visible during a background refresh', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'codex',
          models: ['gpt-5.4', 'gpt-5.3-codex'],
        },
      ],
    };
    storeState.cliStatusLoading = true;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'codex',
          onProviderChange: () => undefined,
          value: '',
          onValueChange: () => undefined,
        })
      );
      await Promise.resolve();
    });

    expect(host.textContent).toContain('5.4');
    expect(host.textContent).toContain('5.3 Codex');
    expect(host.textContent).not.toContain('Explicit models load from the current runtime');
    expect(host.querySelector('[data-testid="team-model-selector-model-search"]')).toBeNull();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('does not normalize a selected Codex model while the account snapshot is pending', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'codex',
          supported: false,
          authenticated: false,
          verificationState: 'unknown',
          statusMessage: 'Codex CLI not found',
          models: [],
          modelVerificationState: 'idle',
          modelAvailability: [],
        },
      ],
    };
    codexAccountHookState.loading = true;
    codexAccountHookState.snapshot = {
      preferredAuthMode: 'chatgpt',
      effectiveAuthMode: null,
      launchAllowed: false,
      launchIssueMessage: 'Codex CLI not found',
      launchReadinessState: 'runtime_missing',
      appServerState: 'runtime-missing',
      appServerStatusMessage: 'Codex CLI not found',
      managedAccount: null,
      apiKey: { available: false, source: null, sourceLabel: null },
      requiresOpenaiAuth: null,
      login: { status: 'idle', error: null, startedAt: null },
      rateLimits: null,
      updatedAt: '2026-07-21T10:00:00.000Z',
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onValueChange = vi.fn();

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'codex',
          onProviderChange: () => undefined,
          value: 'gpt-5.4',
          onValueChange,
        })
      );
      await Promise.resolve();
    });

    expect(onValueChange).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Explicit models load from the current runtime');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('shows 5.2 Codex as a disabled tile when the runtime still reports it', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'codex',
          models: ['gpt-5.4', 'gpt-5.2-codex'],
          modelVerificationState: 'idle',
          modelAvailability: [],
        },
      ],
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onValueChange = vi.fn();

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'codex',
          onProviderChange: () => undefined,
          value: '',
          onValueChange,
        })
      );
      await Promise.resolve();
    });

    const disabledButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('5.2 Codex')
    );

    expect(disabledButton).not.toBeNull();
    expect(disabledButton?.getAttribute('aria-disabled')).toBe('true');
    expect(disabledButton?.textContent).toContain('Disabled');
    expect(disabledButton?.getAttribute('aria-label')).toContain(
      'Temporarily disabled for team agents - this model is not currently available on the Codex native runtime.'
    );

    await act(async () => {
      disabledButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(onValueChange).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('keeps known disabled Codex tiles visible when the runtime omits them', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'codex',
          models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2'],
          modelVerificationState: 'idle',
          modelAvailability: [],
        },
      ],
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onValueChange = vi.fn();

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'codex',
          onProviderChange: () => undefined,
          value: '',
          onValueChange,
        })
      );
      await Promise.resolve();
    });

    const disabledButtons = ['5.3 Codex Spark', '5.2 Codex', '5.1 Codex Mini'].map((label) => {
      const button = Array.from(host.querySelectorAll('button')).find((candidate) =>
        candidate.textContent?.includes(label)
      );
      expect(button, `${label} should stay visible as a disabled option`).not.toBeNull();
      expect(button?.getAttribute('aria-disabled')).toBe('true');
      expect(button?.textContent).toContain('Disabled');
      expect(button?.getAttribute('aria-label')).toContain('Temporarily disabled for team agents');
      return button;
    });

    const activeButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('5.2')
    );
    expect(activeButton?.textContent).not.toContain('Recommended');
    expect(activeButton?.getAttribute('aria-disabled')).toBe('false');

    await act(async () => {
      disabledButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(onValueChange).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('keeps 5.1 Codex Max selectable on the native Codex path', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'codex',
          authMethod: 'api_key',
          backend: {
            kind: 'codex-native',
            label: 'Codex native',
            endpointLabel: 'codex exec --json',
          },
          models: ['gpt-5.4', 'gpt-5.1-codex-max'],
          modelVerificationState: 'idle',
          modelAvailability: [],
        },
      ],
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onValueChange = vi.fn();

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'codex',
          onProviderChange: () => undefined,
          value: '',
          onValueChange,
        })
      );
      await Promise.resolve();
    });

    const button = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('5.1 Codex Max')
    );

    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-disabled')).toBe('false');
    expect(button?.textContent).not.toContain('Disabled');

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(onValueChange).toHaveBeenCalledWith('gpt-5.1-codex-max');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('disables 5.1 Codex Max when the live Codex snapshot says ChatGPT account mode', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'codex',
          authMethod: null,
          backend: null,
          models: ['gpt-5.4', 'gpt-5.1-codex-max'],
          modelVerificationState: 'idle',
          modelAvailability: [],
        },
      ],
    };
    codexAccountHookState.snapshot = {
      preferredAuthMode: 'chatgpt',
      effectiveAuthMode: 'chatgpt',
      launchAllowed: true,
      launchIssueMessage: null,
      launchReadinessState: 'ready_chatgpt',
      appServerState: 'healthy',
      appServerStatusMessage: null,
      managedAccount: {
        type: 'chatgpt',
        email: 'user@example.com',
        planType: 'pro',
      },
      apiKey: {
        available: false,
        source: null,
        sourceLabel: null,
      },
      requiresOpenaiAuth: false,
      localAccountArtifactsPresent: false,
      login: {
        status: 'idle',
        error: null,
        startedAt: null,
      },
      rateLimits: null,
      updatedAt: new Date().toISOString(),
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'codex',
          onProviderChange: () => undefined,
          value: '',
          onValueChange: () => undefined,
        })
      );
      await Promise.resolve();
    });

    expect(host.textContent).toContain('5.4');
    const disabledButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('5.1 Codex Max')
    );
    expect(disabledButton).not.toBeNull();
    expect(disabledButton?.getAttribute('aria-disabled')).toBe('true');
    expect(disabledButton?.textContent).toContain('Disabled');
    expect(disabledButton?.getAttribute('aria-label')).toContain(
      'Temporarily disabled for team agents - this model is not currently available on the Codex native runtime.'
    );

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('keeps runtime model buttons selectable without starting automatic model probes', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'codex',
          models: ['gpt-5.4', 'gpt-5.4-mini'],
          modelVerificationState: 'idle',
          modelAvailability: [],
        },
      ],
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onValueChange = vi.fn();

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'codex',
          onProviderChange: () => undefined,
          value: '',
          onValueChange,
        })
      );
      await Promise.resolve();
    });

    expect(storeState.fetchCliProviderStatus).not.toHaveBeenCalled();

    const gpt54Button = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('5.4')
    );
    expect(gpt54Button?.getAttribute('aria-disabled')).toBe('false');

    await act(async () => {
      gpt54Button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(onValueChange).toHaveBeenCalledWith('gpt-5.4');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('highlights the specific model tile when preflight found a model issue', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'codex',
          models: ['gpt-5.4', 'gpt-5.2-codex'],
          modelVerificationState: 'idle',
          modelAvailability: [],
        },
      ],
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'codex',
          onProviderChange: () => undefined,
          value: 'gpt-5.2-codex',
          onValueChange: () => undefined,
          modelIssueReasonByValue: {
            'gpt-5.2-codex': 'Not available on this Codex native runtime',
          },
        })
      );
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Issue');
    const issueButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('5.2 Codex')
    );
    expect(issueButton?.className).toContain('border-red-500/40');
    expect(issueButton?.getAttribute('aria-label')).toContain(
      'Not available on this Codex native runtime'
    );

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('keeps the curated Anthropic picker surface while showing runtime-backed labels', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'anthropic',
          models: ['opus', 'claude-opus-4-6', 'sonnet', 'haiku'],
          modelCatalog: {
            schemaVersion: 1,
            providerId: 'anthropic',
            source: 'anthropic-models-api',
            status: 'ready',
            fetchedAt: '2026-04-21T00:00:00.000Z',
            staleAt: '2026-04-21T00:10:00.000Z',
            defaultModelId: 'opus[1m]',
            defaultLaunchModel: 'opus[1m]',
            models: [
              {
                id: 'opus',
                launchModel: 'opus',
                displayName: 'Opus 4.8',
                hidden: false,
                supportedReasoningEfforts: ['low', 'medium', 'high'],
                defaultReasoningEffort: null,
                inputModalities: ['text', 'image'],
                supportsPersonality: false,
                isDefault: false,
                upgrade: false,
                source: 'anthropic-models-api',
                badgeLabel: 'Opus 4.8',
              },
              {
                id: 'opus[1m]',
                launchModel: 'opus[1m]',
                displayName: 'Opus 4.8 (1M)',
                hidden: true,
                supportedReasoningEfforts: ['low', 'medium', 'high'],
                defaultReasoningEffort: null,
                inputModalities: ['text', 'image'],
                supportsPersonality: false,
                isDefault: true,
                upgrade: false,
                source: 'anthropic-models-api',
              },
              {
                id: 'claude-opus-4-6',
                launchModel: 'claude-opus-4-6',
                displayName: 'Opus 4.6',
                hidden: false,
                supportedReasoningEfforts: ['low', 'medium', 'high'],
                defaultReasoningEffort: null,
                inputModalities: ['text', 'image'],
                supportsPersonality: false,
                isDefault: false,
                upgrade: false,
                source: 'anthropic-models-api',
                badgeLabel: 'Opus 4.6',
              },
              {
                id: 'sonnet',
                launchModel: 'sonnet',
                displayName: 'Sonnet 4.7',
                hidden: false,
                supportedReasoningEfforts: ['low', 'medium', 'high'],
                defaultReasoningEffort: null,
                inputModalities: ['text', 'image'],
                supportsPersonality: false,
                isDefault: false,
                upgrade: false,
                source: 'anthropic-models-api',
                badgeLabel: 'Sonnet 4.7',
              },
              {
                id: 'haiku',
                launchModel: 'haiku',
                displayName: 'Haiku 4.6',
                hidden: false,
                supportedReasoningEfforts: [],
                defaultReasoningEffort: null,
                inputModalities: ['text', 'image'],
                supportsPersonality: false,
                isDefault: false,
                upgrade: false,
                source: 'anthropic-models-api',
                badgeLabel: 'Haiku 4.6',
              },
            ],
            diagnostics: {
              configReadState: 'ready',
              appServerState: 'healthy',
              message: null,
              code: null,
            },
          },
          runtimeCapabilities: {
            modelCatalog: {
              dynamic: true,
              source: 'anthropic-models-api',
            },
            reasoningEffort: {
              supported: true,
              values: ['low', 'medium', 'high'],
              configPassthrough: false,
            },
          },
        },
      ],
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'anthropic',
          onProviderChange: () => undefined,
          value: '',
          onValueChange: () => undefined,
        })
      );
      await Promise.resolve();
    });

    const modelButtons = Array.from(host.querySelectorAll('button')).map(
      (button) => button.textContent?.trim() ?? ''
    );
    const hasModelButtonStartingWith = (label: string): boolean =>
      modelButtons.some((text) => text.startsWith(label));

    expect(hasModelButtonStartingWith('Default')).toBe(true);
    expect(hasModelButtonStartingWith('Opus 4.8')).toBe(true);
    expect(hasModelButtonStartingWith('Opus 4.6')).toBe(true);
    expect(hasModelButtonStartingWith('Sonnet 4.7')).toBe(true);
    expect(hasModelButtonStartingWith('Haiku 4.6')).toBe(true);
    expect(hasModelButtonStartingWith('Opus 4.8 (1M)')).toBe(false);

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('commits the Anthropic fallback when a frozen Gemini selection is corrected', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onProviderChange = vi.fn();

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'gemini',
          onProviderChange,
          value: '',
          onValueChange: () => undefined,
          disableGeminiOption: true,
        })
      );
      await Promise.resolve();
    });

    const anthropicTab = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Anthropic')
    );
    expect(anthropicTab?.getAttribute('data-state')).toBe('active');

    await act(async () => {
      anthropicTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(onProviderChange).toHaveBeenCalledWith('anthropic');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });
});
