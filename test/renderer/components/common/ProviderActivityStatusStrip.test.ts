import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { ProviderActivityStatusStrip } from '@renderer/components/common/ProviderActivityStatusStrip';
import { createDefaultCliExtensionCapabilities } from '@shared/utils/providerExtensionCapabilities';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliInstallationStatus, CliProviderId, CliProviderStatus } from '@shared/types';

vi.mock('@renderer/api', () => ({
  isElectronMode: () => true,
}));

vi.mock('@renderer/components/common/ProviderBrandLogo', () => ({
  ProviderBrandLogo: ({ providerId }: { providerId: string }) =>
    React.createElement('span', { 'data-testid': `provider-logo-${providerId}` }, providerId),
}));

function createProvider(
  overrides: Partial<CliProviderStatus> & {
    providerId: CliProviderId;
    displayName: string;
  }
): CliProviderStatus {
  const { providerId, displayName, ...rest } = overrides;
  return {
    providerId,
    displayName,
    supported: true,
    authenticated: false,
    authMethod: null,
    verificationState: 'verified',
    statusMessage: null,
    detailMessage: null,
    models: [],
    modelVerificationState: 'idle',
    modelAvailability: [],
    canLoginFromUi: true,
    capabilities: {
      teamLaunch: true,
      oneShot: true,
      extensions: createDefaultCliExtensionCapabilities(),
    },
    backend: null,
    availableBackends: [],
    connection: null,
    ...rest,
  };
}

function createMultimodelStatus(providers: CliProviderStatus[]): CliInstallationStatus {
  return {
    flavor: 'claude',
    displayName: 'Multimodel runtime',
    supportsSelfUpdate: false,
    showVersionDetails: false,
    showBinaryPath: false,
    installed: true,
    installedVersion: '0.0.3',
    binaryPath: '/tmp/claude-multimodel',
    launchError: null,
    latestVersion: null,
    updateAvailable: false,
    authLoggedIn: providers.some((provider) => provider.authenticated === true),
    authStatusChecking: false,
    authMethod: null,
    providers,
  };
}

function renderStrip(
  host: HTMLElement,
  props: Partial<React.ComponentProps<typeof ProviderActivityStatusStrip>> & {
    cliStatus: CliInstallationStatus | null;
  }
): ReturnType<typeof createRoot> {
  const root = createRoot(host);
  root.render(
    React.createElement(ProviderActivityStatusStrip, {
      sourceCliStatus: props.cliStatus,
      cliStatusLoading: false,
      cliProviderStatusLoading: {},
      multimodelEnabled: true,
      ...props,
    })
  );
  return root;
}

describe('ProviderActivityStatusStrip', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });
});
