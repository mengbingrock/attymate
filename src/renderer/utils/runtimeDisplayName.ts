import type { CliFlavor, CliInstallationStatus } from '@shared/types';

export function getRuntimeDisplayName(
  cliStatus: Pick<CliInstallationStatus, 'flavor' | 'displayName'> | null | undefined,
  _multimodelEnabledFallback = false
): string {
  if (cliStatus?.displayName) {
    return cliStatus.displayName;
  }

  return 'Claude CLI';
}

export function getRuntimeCommandLabel(_flavor: CliFlavor): string {
  return 'Claude CLI';
}
