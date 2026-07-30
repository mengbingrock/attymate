import { useEffect, useRef, useState } from 'react';

import { useStore } from '@renderer/store';
import { getCliProviderStatusScopeKey } from '@renderer/store/slices/cliInstallerSlice';
import { isTeamProviderModelCatalogFresh } from '@renderer/utils/teamModelAvailability';

import type { CliProviderStatus } from '@shared/types';

const OPENCODE_CATALOG_PREFETCH_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;
const OPENCODE_BACKGROUND_PREFETCH_FALLBACK_DELAY_MS = 1_500;
const OPENCODE_BACKGROUND_PREFETCH_IDLE_TIMEOUT_MS = 5_000;
const MAX_BROWSER_TIMEOUT_MS = 2_147_483_647;

type OpenCodeCatalogPrefetchPriority = 'background' | 'required';

export interface OpenCodeCatalogPrefetchState {
  requiredCatalogPending: boolean;
}

function getCatalogStaleAtMs(providerStatus: CliProviderStatus | null): number | null {
  const staleAt = providerStatus?.modelCatalog?.staleAt;
  if (!staleAt) {
    return null;
  }

  const staleAtMs = Date.parse(staleAt);
  return Number.isFinite(staleAtMs) ? staleAtMs : null;
}

function schedulePrefetch(
  callback: () => void,
  priority: OpenCodeCatalogPrefetchPriority
): () => void {
  if (priority === 'required') {
    const timeoutId = window.setTimeout(callback, 0);
    return () => window.clearTimeout(timeoutId);
  }

  if (
    typeof window.requestIdleCallback === 'function' &&
    typeof window.cancelIdleCallback === 'function'
  ) {
    const idleHandle = window.requestIdleCallback(callback, {
      timeout: OPENCODE_BACKGROUND_PREFETCH_IDLE_TIMEOUT_MS,
    });
    return () => window.cancelIdleCallback(idleHandle);
  }

  const timeoutId = window.setTimeout(callback, OPENCODE_BACKGROUND_PREFETCH_FALLBACK_DELAY_MS);
  return () => window.clearTimeout(timeoutId);
}

export function useOpenCodeCatalogPrefetch({
  enabled,
  projectPath,
  priority = 'background',
  deferBackground = false,
}: {
  enabled: boolean;
  projectPath: string | null | undefined;
  priority?: OpenCodeCatalogPrefetchPriority;
  deferBackground?: boolean;
}): OpenCodeCatalogPrefetchState {
  // The OpenCode model catalog was hydrated through the bundled multimodel
  // runtime, which this fork no longer ships; there is nothing to prefetch.
  void enabled;
  void projectPath;
  void priority;
  void deferBackground;
  return { requiredCatalogPending: false };
}
