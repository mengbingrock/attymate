import type { CliFlavor, CliFlavorUiOptions } from '@shared/types';

export const DEFAULT_CLI_FLAVOR: CliFlavor = 'claude';

export function getConfiguredCliFlavor(): CliFlavor {
  return DEFAULT_CLI_FLAVOR;
}

export function getCliFlavorUiOptions(_flavor: CliFlavor): CliFlavorUiOptions {
  return {
    displayName: 'Claude CLI',
    supportsSelfUpdate: true,
    showVersionDetails: true,
    showBinaryPath: true,
  };
}

export function getCliFlavorCommandLabel(_flavor: CliFlavor): string {
  return 'claude';
}

export function getConfiguredCliCommandLabel(): string {
  return getCliFlavorCommandLabel(getConfiguredCliFlavor());
}
