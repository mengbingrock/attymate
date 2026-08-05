import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OPENCODE_SHARED_CACHE_NODE_MODULES_RELATIVE = path.join(
  'Cache',
  'opencode',
  'shared-cache',
  'config-node_modules'
);
const OPENCODE_PROFILES_BASE_RELATIVE = path.join('Data', 'opencode', 'profiles');
const OPENCODE_SHARED_CACHE_SUFFIX_PARTS = [
  'Cache',
  'opencode',
  'shared-cache',
  'config-node_modules',
];
const OPENCODE_PROFILE_NODE_MODULES_SUFFIX_TAIL = ['config', 'opencode', 'node_modules'];

function getLocalAppDataPath(): string {
  return process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
}

function getBaseDir(): string {
  return path.join(getLocalAppDataPath(), 'legacy-agent-runtime');
}

export function getSharedCacheNodeModulesPath(): string {
  return path.join(getBaseDir(), OPENCODE_SHARED_CACHE_NODE_MODULES_RELATIVE);
}

export function getProfileNodeModulesPath(profileId: string): string {
  return path.join(
    getBaseDir(),
    OPENCODE_PROFILES_BASE_RELATIVE,
    profileId,
    'config',
    'opencode',
    'node_modules'
  );
}

export function isOpenCodeNodeModulesSymlinkError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    (normalized.includes('eperm') || normalized.includes('eacces')) &&
    normalized.includes('symlink') &&
    normalized.includes('opencode') &&
    normalized.includes('node_modules')
  );
}

function normalizeErrorPathSeparators(value: string): string {
  return value.replace(/\\\\/g, '\\');
}

function normalizePathForComparison(value: string): string {
  return normalizeErrorPathSeparators(value)
    .replace(/[\\/]+/g, '/')
    .toLowerCase();
}

function isAbsolutePath(candidate: string): boolean {
  const normalized = normalizeErrorPathSeparators(candidate);
  return path.win32.isAbsolute(normalized) || path.posix.isAbsolute(normalized);
}

function getExpectedProfileSuffixParts(profileId: string): string[] {
  return ['Data', 'opencode', 'profiles', profileId, ...OPENCODE_PROFILE_NODE_MODULES_SUFFIX_TAIL];
}

function getPathBaseBeforeSuffix(candidate: string, suffixParts: readonly string[]): string | null {
  const normalized = normalizePathForComparison(candidate);
  const suffix = suffixParts.join('/').toLowerCase();
  if (!normalized.endsWith(`/${suffix}`)) {
    return null;
  }
  return normalized.slice(0, -suffix.length - 1);
}

function isExpectedProfileNodeModulesPath(candidate: string, profileId: string): boolean {
  return Boolean(
    profileId &&
    isAbsolutePath(candidate) &&
    getPathBaseBeforeSuffix(candidate, getExpectedProfileSuffixParts(profileId))
  );
}

function isExpectedSharedCacheNodeModulesPath(candidate: string): boolean {
  return Boolean(
    isAbsolutePath(candidate) &&
    getPathBaseBeforeSuffix(candidate, OPENCODE_SHARED_CACHE_SUFFIX_PARTS)
  );
}

function extractedPathsShareBase(source: string, target: string, profileId: string): boolean {
  const sourceBase = getPathBaseBeforeSuffix(source, OPENCODE_SHARED_CACHE_SUFFIX_PARTS);
  const targetBase = getPathBaseBeforeSuffix(target, getExpectedProfileSuffixParts(profileId));
  return Boolean(sourceBase && targetBase && sourceBase === targetBase);
}

export function extractProfileIdFromSymlinkError(message: string): string | null {
  const profilePathPattern = /profiles[\\/]([0-9a-f]+)[\\/]config[\\/]opencode[\\/]node_modules/i;
  const match = profilePathPattern.exec(normalizeErrorPathSeparators(message));
  return match ? match[1] : null;
}

const SYMLINK_SOURCE_PATTERN = /symlink\s+'([^']+)'/i;
const SYMLINK_TARGET_PATTERN = /->\s+'([^']+)'/i;

export function extractSymlinkSourcePath(message: string): string | null {
  const match = SYMLINK_SOURCE_PATTERN.exec(message);
  return match ? normalizeErrorPathSeparators(match[1]) : null;
}

export function extractSymlinkTargetPath(message: string): string | null {
  const match = SYMLINK_TARGET_PATTERN.exec(message);
  return match ? normalizeErrorPathSeparators(match[1]) : null;
}

export function ensureOpenCodeProfileNodeModulesJunction(
  profileId: string,
  errorMessage?: string
): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  let source = getSharedCacheNodeModulesPath();
  let target = getProfileNodeModulesPath(profileId);

  if (errorMessage) {
    const extractedSource = extractSymlinkSourcePath(errorMessage);
    const extractedTarget = extractSymlinkTargetPath(errorMessage);

    if (
      extractedTarget &&
      isExpectedProfileNodeModulesPath(extractedTarget, profileId) &&
      (!extractedSource || isExpectedSharedCacheNodeModulesPath(extractedSource)) &&
      (!extractedSource || extractedPathsShareBase(extractedSource, extractedTarget, profileId))
    ) {
      target = extractedTarget;
      source = extractedSource ?? source;
    }
  }

  try {
    const existingStat = fs.statSync(target, { throwIfNoEntry: false });
    if (existingStat !== undefined) {
      return true;
    }
  } catch {
    // Target does not exist, proceed to create junction.
  }

  try {
    const sourceStat = fs.statSync(source, { throwIfNoEntry: false });
    if (sourceStat === undefined) {
      return false;
    }
  } catch {
    return false;
  }

  const parentDir = path.dirname(target);
  try {
    fs.mkdirSync(parentDir, { recursive: true });
  } catch {
    return false;
  }

  try {
    fs.symlinkSync(source, target, 'junction');
    return true;
  } catch {
    return false;
  }
}
