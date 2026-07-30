import { describe, expect, it } from 'vitest';

import {
  formatCliExtensionCapabilityStatus,
  getVisibleMultimodelProviders,
  isMultimodelRuntimeStatus,
} from '@renderer/utils/multimodelProviderVisibility';
import type { CliInstallationStatus, CliProviderStatus } from '@shared/types';
import { createDefaultCliExtensionCapabilities } from '@shared/utils/providerExtensionCapabilities';

function createProvider(providerId: CliProviderStatus['providerId']): CliProviderStatus {
  return {
    providerId,
    displayName:
      providerId === 'anthropic' ? 'Anthropic' : providerId === 'codex' ? 'Codex' : 'Gemini',
    supported: true,
    authenticated: true,
    authMethod: 'oauth_token',
    verificationState: 'verified',
    canLoginFromUi: true,
    capabilities: {
      teamLaunch: true,
      oneShot: true,
      extensions: createDefaultCliExtensionCapabilities(),
    },
    statusMessage: null,
    selectedBackendId: null,
    resolvedBackendId: null,
    availableBackends: [],
    externalRuntimeDiagnostics: [],
    models: [],
    backend: null,
    connection: null,
  };
}

describe('multimodelProviderVisibility', () => {

  it('filters Gemini from the visible provider cards while keeping supported providers', () => {
    const providers = [
      createProvider('anthropic'),
      createProvider('codex'),
      createProvider('gemini'),
    ];

    expect(getVisibleMultimodelProviders(providers).map((provider) => provider.providerId)).toEqual(
      ['anthropic', 'codex']
    );
  });

  it('formats capability statuses without collapsing read-only into a vague limited label', () => {
    expect(formatCliExtensionCapabilityStatus('supported')).toBe('supported');
    expect(formatCliExtensionCapabilityStatus('read-only')).toBe('read-only');
    expect(formatCliExtensionCapabilityStatus('unsupported')).toBe('unsupported');
  });
});
