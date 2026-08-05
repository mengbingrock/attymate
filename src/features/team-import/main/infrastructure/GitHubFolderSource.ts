import { net } from 'electron';

import { TEAM_IMPORT_RAW_SOURCE_LIMITS } from './SafeArbitraryFolderRawSource';

import type {
  TeamImportRawSourceDump,
  TeamImportRawSourceFile,
} from '../../core/domain/teamImportLlmPrompt';

const FETCH_TIMEOUT_MS = 20_000;
const FILE_FETCH_CONCURRENCY = 8;

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.yaml', '.yml', '.txt', '.json']);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.venv',
  '__pycache__',
]);

export interface GitHubFolderRef {
  owner: string;
  repo: string;
  ref: string;
  /** Folder within the repo; empty for the repository root. */
  subPath: string;
}

/**
 * A github.com `/tree/` or `/blob/` URL points at a rendered listing page, not
 * at file content. Fetching it as a webpage yields folder names and the README
 * — enough for the parser to name members it can then find no source for.
 * Recognizing the URL lets us read the actual files instead.
 */
export function parseGitHubFolderUrl(rawUrl: string): GitHubFolderRef | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const [owner, repo, kind, ref, ...rest] = segments;
  if (!owner || !repo) return null;
  if (kind !== 'tree' && kind !== 'blob') {
    // A bare repo URL still has a default branch worth reading.
    return segments.length === 2 ? { owner, repo, ref: 'HEAD', subPath: '' } : null;
  }
  if (!ref) return null;
  return { owner, repo, ref, subPath: rest.join('/') };
}

function isTextPath(path: string): boolean {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  if (path.split('/').some((segment) => SKIPPED_DIRECTORIES.has(segment))) return false;
  return TEXT_EXTENSIONS.has(lower.slice(dot));
}

interface FetchedBody {
  ok: boolean;
  status: number;
  text: string;
}

/**
 * Reads a whole response under one deadline. Aborting only around the headers
 * would leave the body read untimed, so a stalled transfer hangs the import
 * with nothing to show for it.
 */
async function fetchWithTimeout(url: string, accept: string): Promise<FetchedBody> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await net.fetch(url, {
      signal: controller.signal,
      headers: { Accept: accept },
    });
    const text = response.ok ? await response.text() : '';
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out fetching ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

interface GitTreeEntry {
  path: string;
  type: string;
  size?: number;
}

/**
 * Reads a folder of a public GitHub repository into the same bounded text dump
 * shape a local folder produces, so the parser sees real file content with
 * repo-relative paths.
 *
 * One recursive trees API call enumerates the repository (the unauthenticated
 * API allows few calls per hour, so we spend exactly one), then only the files
 * that survive the text/size filters are pulled from raw.githubusercontent.com.
 */
export class GitHubFolderSource {
  async readFolder(ref: GitHubFolderRef): Promise<TeamImportRawSourceDump> {
    const treeUrl = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(
      ref.repo
    )}/git/trees/${encodeURIComponent(ref.ref)}?recursive=1`;

    const response = await fetchWithTimeout(treeUrl, 'application/vnd.github+json');
    if (!response.ok) {
      throw new Error(
        response.status === 403 || response.status === 429
          ? 'GitHub rate-limited this request. Wait a few minutes, or clone the repository and import the folder instead.'
          : `GitHub returned HTTP ${response.status} for that repository.`
      );
    }

    let payload: { tree?: GitTreeEntry[]; truncated?: boolean };
    try {
      payload = JSON.parse(response.text) as { tree?: GitTreeEntry[]; truncated?: boolean };
    } catch {
      throw new Error('GitHub returned an unreadable repository listing.');
    }
    const tree = Array.isArray(payload.tree) ? payload.tree : [];
    if (tree.length === 0) {
      throw new Error('That repository reference contains no files.');
    }

    const prefix = ref.subPath ? `${ref.subPath.replace(/\/+$/, '')}/` : '';
    const candidates = tree
      .filter((entry) => entry.type === 'blob' && entry.path.startsWith(prefix))
      .filter((entry) => isTextPath(entry.path))
      .filter((entry) => (entry.size ?? 0) <= TEAM_IMPORT_RAW_SOURCE_LIMITS.maxFileBytes)
      .sort((left, right) => left.path.localeCompare(right.path));

    if (candidates.length === 0) {
      throw new Error(
        ref.subPath
          ? `No readable text files were found under "${ref.subPath}" at that revision.`
          : 'No readable text files were found in that repository.'
      );
    }

    // Keep within the same budget a local folder import gets, so downstream
    // prompt sizes are identical whichever source the user picked.
    const selected: GitTreeEntry[] = [];
    let dumpBytes = 0;
    let truncated = payload.truncated === true;
    for (const entry of candidates) {
      if (selected.length >= TEAM_IMPORT_RAW_SOURCE_LIMITS.maxFiles) {
        truncated = true;
        break;
      }
      const size = entry.size ?? 0;
      if (dumpBytes + size > TEAM_IMPORT_RAW_SOURCE_LIMITS.maxDumpBytes) {
        truncated = true;
        continue;
      }
      dumpBytes += size;
      selected.push(entry);
    }
    if (selected.length === 0) {
      throw new Error('Every file under that folder exceeds the import size budget.');
    }

    const files = await this.fetchFiles(ref, selected, prefix);
    if (files.length === 0) {
      throw new Error('The files under that folder could not be downloaded.');
    }

    return {
      label: `github ${ref.owner}/${ref.repo}${ref.subPath ? `/${ref.subPath}` : ''}`,
      files,
      truncated: truncated || files.length < selected.length,
    };
  }

  private async fetchFiles(
    ref: GitHubFolderRef,
    entries: readonly GitTreeEntry[],
    prefix: string
  ): Promise<TeamImportRawSourceFile[]> {
    const files: (TeamImportRawSourceFile | null)[] = entries.map(() => null);
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < entries.length) {
        const index = next++;
        const entry = entries[index];
        const rawUrl = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${ref.ref}/${entry.path
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/')}`;
        try {
          const response = await fetchWithTimeout(rawUrl, 'text/plain,*/*;q=0.5');
          if (!response.ok) continue;
          const content = response.text.slice(0, TEAM_IMPORT_RAW_SOURCE_LIMITS.maxFileBytes);
          if (!content.trim()) continue;
          // Paths are relative to the requested folder so the parser's
          // sourcePaths match what a local import of the same folder produces.
          files[index] = { path: entry.path.slice(prefix.length), content };
        } catch {
          // One unreadable file must not sink the import.
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(FILE_FETCH_CONCURRENCY, entries.length) }, () => worker())
    );
    return files.filter((file): file is TeamImportRawSourceFile => file !== null);
  }
}
