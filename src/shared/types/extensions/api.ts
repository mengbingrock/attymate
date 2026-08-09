/**
 * Extension Store API contracts — exposed via preload bridge.
 * Both APIs are OPTIONAL in ElectronAPI (Electron-only V1).
 */

import type {
  ApiKeyEntry,
  ApiKeyLookupResult,
  ApiKeySaveRequest,
  ApiKeyStorageStatus,
} from './apikey';
import type { OperationResult } from './common';
import type {
  InstalledMcpEntry,
  McpCatalogItem,
  McpCustomInstallRequest,
  McpInstallRequest,
  McpSearchResult,
  McpServerDiagnostic,
} from './mcp';
import type { EnrichedPlugin, PluginInstallRequest, PluginInstallScope } from './plugin';
import type {
  SkillCatalogItem,
  SkillDeleteRequest,
  SkillDetail,
  SkillImportRequest,
  SkillReviewPreview,
  SkillUpsertRequest,
  SkillWatcherEvent,
} from './skill';

// ── Plugin API ─────────────────────────────────────────────────────────────

export interface PluginCatalogAPI {
  getAll: (projectPath?: string, forceRefresh?: boolean) => Promise<EnrichedPlugin[]>;
  getReadme: (pluginId: string) => Promise<string | null>;
  install: (request: PluginInstallRequest) => Promise<OperationResult>;
  uninstall: (
    pluginId: string,
    scope?: PluginInstallScope,
    projectPath?: string
  ) => Promise<OperationResult>;
}

// ── MCP API ────────────────────────────────────────────────────────────────

export interface McpCatalogAPI {
  search: (query: string, limit?: number) => Promise<McpSearchResult>;
  browse: (
    cursor?: string,
    limit?: number
  ) => Promise<{ servers: McpCatalogItem[]; nextCursor?: string }>;
  getById: (registryId: string) => Promise<McpCatalogItem | null>;
  getInstalled: (projectPath?: string) => Promise<InstalledMcpEntry[]>;
  diagnose: (projectPath?: string) => Promise<McpServerDiagnostic[]>;
  install: (request: McpInstallRequest) => Promise<OperationResult>;
  installCustom: (request: McpCustomInstallRequest) => Promise<OperationResult>;
  uninstall: (name: string, scope?: string, projectPath?: string) => Promise<OperationResult>;
  githubStars: (repositoryUrls: string[]) => Promise<Record<string, number>>;
}

// ── Skills API ─────────────────────────────────────────────────────────────

/**
 * Which roots a catalog listing should cover. A bare string stays supported for
 * the plain-projectPath call sites.
 */
export interface SkillsListOptions {
  projectPath?: string;
  teamName?: string;
}

export interface SkillsCatalogAPI {
  list: (options?: string | SkillsListOptions) => Promise<SkillCatalogItem[]>;
  getDetail: (skillId: string, options?: string | SkillsListOptions) => Promise<SkillDetail | null>;
  previewUpsert: (request: SkillUpsertRequest) => Promise<SkillReviewPreview>;
  applyUpsert: (request: SkillUpsertRequest) => Promise<SkillDetail | null>;
  previewImport: (request: SkillImportRequest) => Promise<SkillReviewPreview>;
  applyImport: (request: SkillImportRequest) => Promise<SkillDetail | null>;
  deleteSkill: (request: SkillDeleteRequest) => Promise<void>;
  startWatching: (projectPath?: string) => Promise<string>;
  stopWatching: (watchId: string) => Promise<void>;
  onChanged: (callback: (event: SkillWatcherEvent) => void) => () => void;
}

// ── API Keys API ──────────────────────────────────────────────────────────

export interface ApiKeysAPI {
  list: () => Promise<ApiKeyEntry[]>;
  save: (request: ApiKeySaveRequest) => Promise<ApiKeyEntry>;
  delete: (id: string) => Promise<void>;
  lookup: (envVarNames: string[], projectPath?: string) => Promise<ApiKeyLookupResult[]>;
  getStorageStatus: () => Promise<ApiKeyStorageStatus>;
}
