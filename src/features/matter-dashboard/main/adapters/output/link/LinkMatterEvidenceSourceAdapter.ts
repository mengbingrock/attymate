import { createHash } from 'node:crypto';
import * as path from 'node:path';

import {
  type LinkCommandRunner,
  LinkCommandUnavailableError,
  NodeLinkCommandRunner,
} from './LinkCommandRunner';

import type {
  MatterEvidenceCountsDto,
  MatterEvidenceStatusDto,
  MatterEvidenceStatusState,
} from '../../../../contracts';
import type {
  MatterEvidenceContext,
  MatterEvidenceItem,
  MatterEvidenceQueryBundle,
  MatterEvidenceSourcePort,
} from '../../../../core/application/ports/MatterEvidenceSourcePort';

const DASHBOARD_QUERIES = [
  {
    topic: 'matter identity and posture',
    query: 'DOCKET_CROSSCHECK_REPORT',
    pathHints: ['docket', 'case-summary', 'matter-summary'],
  },
  {
    topic: 'pleadings',
    query: 'PLEADING_INTAKE_REPORT',
    pathHints: ['pleading', 'complaint', 'answer', 'cross-complaint'],
  },
  {
    topic: 'discovery',
    query: 'MTC motion compel subpoena nonparty',
    pathHints: ['mtc', 'discovery', 'production', 'deposition', 'subpoena', 'meet-confer'],
  },
  {
    topic: 'deadlines and trial',
    query: 'LITIGATION_CALENDAR_PROPOSAL',
    pathHints: ['calendar', 'docket', 'deadline', 'trial'],
  },
  {
    topic: 'post-judgment',
    query: 'JUDGMENT enforcement',
    pathHints: ['judgment', 'enforcement'],
  },
] as const;

const MAX_EVIDENCE_ITEMS = 30;
const MAX_EVIDENCE_SUMMARY_CHARS = 2_400;

const EMPTY_COUNTS: MatterEvidenceCountsDto = {
  sourceFiles: 0,
  sourcePages: 0,
  representedFiles: 0,
  pendingFiles: 0,
  staleFiles: 0,
  secretWarnings: 0,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonNegativeInteger(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function mapProviderState(
  providerState: string,
  hasWikiDirectory: boolean
): MatterEvidenceStatusState {
  if (providerState === 'ready') return 'ready';
  if (providerState === 'empty') return 'empty';
  if (providerState === 'pending_raw') return 'pending';
  if (providerState === 'stale_raw' || providerState === 'stale_graph') return 'stale';
  if (providerState.startsWith('blocked_')) return 'blocked';
  if (providerState === 'missing_structure' || !hasWikiDirectory) return 'not-initialized';
  return 'error';
}

function errorSummary(value: string): string {
  const summary = value.trim().replace(/\s+/g, ' ');
  return summary ? summary.slice(0, 500) : 'Link status check failed.';
}

function preflightStatus(context: MatterEvidenceContext): MatterEvidenceStatusDto | null {
  const checkedAt = new Date().toISOString();
  const projectPath = context.projectPath?.trim() || null;
  if (!projectPath) {
    return {
      source: 'link',
      checkedAt,
      projectPath: null,
      state: 'project-unresolved',
      available: false,
      queryReady: false,
      summary: 'This team does not have a project path to use as its Link target.',
      counts: { ...EMPTY_COUNTS },
    };
  }
  if (!path.isAbsolute(projectPath)) {
    return {
      source: 'link',
      checkedAt,
      projectPath,
      state: 'error',
      available: false,
      queryReady: false,
      summary: 'The team project path must be absolute before Link can inspect it.',
      counts: { ...EMPTY_COUNTS },
    };
  }
  return null;
}

function commandFailureStatus(
  projectPath: string,
  error: unknown,
  checkedAt = new Date().toISOString()
): MatterEvidenceStatusDto {
  const unavailable = error instanceof LinkCommandUnavailableError;
  return {
    source: 'link',
    checkedAt,
    projectPath,
    state: unavailable ? 'source-unavailable' : 'error',
    available: !unavailable,
    queryReady: false,
    summary: unavailable
      ? 'Link is not installed or is not available on the application PATH.'
      : errorSummary(error instanceof Error ? error.message : String(error)),
    counts: { ...EMPTY_COUNTS },
  };
}

function substantiveEvidenceText(value: string): string {
  const marker = '## Extracted Content';
  const markerIndex = value.indexOf(marker);
  const substantive = markerIndex >= 0 ? value.slice(markerIndex + marker.length).trim() : value;
  return substantive.slice(0, MAX_EVIDENCE_SUMMARY_CHARS);
}

function readEvidenceItems(
  payload: Record<string, unknown>,
  topic: string,
  pathHints: readonly string[]
): MatterEvidenceItem[] {
  const capsule = asRecord(payload.recall_capsule);
  const contextItems = Array.isArray(payload.context_packet) ? payload.context_packet : [];
  const items =
    contextItems.length > 0 ? contextItems : Array.isArray(capsule?.items) ? capsule.items : [];
  const evidence: MatterEvidenceItem[] = [];
  for (const value of items) {
    const item = asRecord(value);
    if (!item) continue;
    const provenance = asRecord(item.provenance);
    const pathValue =
      asNonEmptyString(provenance?.path) ??
      asNonEmptyString(provenance?.source) ??
      asNonEmptyString(item.name);
    const summary =
      asNonEmptyString(item.content) ??
      asNonEmptyString(item.summary) ??
      asNonEmptyString(item.snippet);
    if (!pathValue || !summary) continue;
    if (pathValue === 'wiki/index.md') continue;
    const descriptor = [pathValue, item.name, item.title, provenance?.source]
      .map((part) => asNonEmptyString(part)?.toLowerCase() ?? '')
      .join(' ');
    if (!pathHints.some((hint) => descriptor.includes(hint))) continue;
    const pageValue = Number(provenance?.page);
    evidence.push({
      topic,
      summary: substantiveEvidenceText(summary),
      ...(asNonEmptyString(item.why_selected)
        ? { whySelected: asNonEmptyString(item.why_selected) }
        : {}),
      reference: {
        path: pathValue,
        ...(asNonEmptyString(provenance?.source)
          ? { source: asNonEmptyString(provenance?.source) }
          : {}),
        ...(asNonEmptyString(item.title) ? { title: asNonEmptyString(item.title) } : {}),
        ...(Number.isInteger(pageValue) && pageValue > 0 ? { page: pageValue } : {}),
        ...(asNonEmptyString(provenance?.section)
          ? { section: asNonEmptyString(provenance?.section) }
          : {}),
        ...(asNonEmptyString(provenance?.date_updated)
          ? { dateUpdated: asNonEmptyString(provenance?.date_updated) }
          : {}),
        ...(asNonEmptyString(provenance?.relationship)
          ? { relationship: asNonEmptyString(provenance?.relationship) }
          : {}),
      },
    });
  }
  return evidence;
}

export class LinkMatterEvidenceSourceAdapter implements MatterEvidenceSourcePort {
  readonly source = 'link' as const;

  constructor(private readonly commandRunner: LinkCommandRunner = new NodeLinkCommandRunner()) {}

  async getStatus(context: MatterEvidenceContext): Promise<MatterEvidenceStatusDto> {
    const checkedAt = new Date().toISOString();
    const preflight = preflightStatus(context);
    if (preflight) return preflight;
    const projectPath = context.projectPath?.trim() || null;
    if (!projectPath) return preflightStatus(context)!;

    try {
      const result = await this.commandRunner.run(['ingest-status', projectPath, '--json']);
      let payload: Record<string, unknown> | null = null;
      try {
        payload = asRecord(JSON.parse(result.stdout));
      } catch {
        // Converted to a stable feature error below.
      }
      if (!payload) {
        return {
          source: this.source,
          checkedAt,
          projectPath,
          state: 'error',
          available: true,
          queryReady: false,
          summary: errorSummary(result.stderr || 'Link returned invalid status JSON.'),
          counts: { ...EMPTY_COUNTS },
        };
      }

      const guidance = asRecord(payload.guidance);
      const providerState =
        asNonEmptyString(guidance?.state) ?? asNonEmptyString(payload.state) ?? 'unknown';
      const state = mapProviderState(providerState, payload.has_wiki_dir === true);
      const counts: MatterEvidenceCountsDto = {
        sourceFiles: asNonNegativeInteger(payload.source_count ?? payload.raw_count),
        sourcePages: asNonNegativeInteger(payload.source_page_count),
        representedFiles: asNonNegativeInteger(payload.represented_count),
        pendingFiles: asNonNegativeInteger(payload.pending_count),
        staleFiles: asNonNegativeInteger(payload.stale_count),
        secretWarnings: asNonNegativeInteger(payload.raw_secret_warning_count),
      };

      return {
        source: this.source,
        checkedAt,
        projectPath,
        state,
        available: true,
        queryReady: state === 'ready',
        summary:
          asNonEmptyString(guidance?.summary) ??
          (result.exitCode === 0 ? 'Link status is available.' : errorSummary(result.stderr)),
        providerState,
        counts,
      };
    } catch (error) {
      return commandFailureStatus(projectPath, error, checkedAt);
    }
  }

  async initialize(context: MatterEvidenceContext): Promise<MatterEvidenceStatusDto> {
    const preflight = preflightStatus(context);
    if (preflight) return preflight;
    const projectPath = context.projectPath!.trim();
    try {
      const result = await this.commandRunner.run(['init', projectPath]);
      if (result.exitCode !== 0) {
        return commandFailureStatus(
          projectPath,
          new Error(errorSummary(result.stderr || result.stdout || 'Link initialization failed.'))
        );
      }
      return this.getStatus(context);
    } catch (error) {
      return commandFailureStatus(projectPath, error);
    }
  }

  async queryDashboardEvidence(context: MatterEvidenceContext): Promise<MatterEvidenceQueryBundle> {
    const preflight = preflightStatus(context);
    if (preflight) throw new Error(preflight.summary);
    const projectPath = context.projectPath!.trim();
    const allEvidence: MatterEvidenceItem[] = [];

    for (const querySpec of DASHBOARD_QUERIES) {
      const result = await this.commandRunner.run([
        'query',
        querySpec.query,
        projectPath,
        '--budget',
        'medium',
        '--json',
      ]);
      if (result.exitCode !== 0) {
        throw new Error(errorSummary(result.stderr || 'Link evidence query failed.'));
      }
      const payload = asRecord(JSON.parse(result.stdout));
      if (!payload) throw new Error('Link returned invalid query JSON.');
      allEvidence.push(...readEvidenceItems(payload, querySpec.topic, querySpec.pathHints));
    }

    const deduped = new Map<string, MatterEvidenceItem>();
    for (const item of allEvidence) {
      const key = `${item.reference.path}\u0000${item.summary}`;
      if (!deduped.has(key)) deduped.set(key, item);
      if (deduped.size >= MAX_EVIDENCE_ITEMS) break;
    }
    const evidence = [...deduped.values()];
    const generatedAt = new Date().toISOString();
    const sourceRevision = createHash('sha256')
      .update(JSON.stringify(evidence))
      .digest('hex')
      .slice(0, 24);

    return {
      source: 'link',
      generatedAt,
      sourceRevision,
      queryCount: DASHBOARD_QUERIES.length,
      evidence,
    };
  }
}
