import { bundleToPreview } from '../../domain/teamImportAgentFilesPolicy';
import { parseTeamImportBundle } from '../../domain/teamImportBundlePolicy';
import { buildBundleExtractionPrompt } from '../../domain/teamImportLlmPrompt';
import {
  assembleBundleJson,
  buildMemberExtractionPrompt,
  buildPlanExtractionPrompt,
  buildSkillExtractionPrompt,
  parseMemberJobOutput,
  parseSkillJobOutput,
  parseTeamImportPlan,
  selectDumpFiles,
} from '../../domain/teamImportParallelParse';
import { buildTeamImportPreview } from '../../domain/teamImportPolicy';

import type { TeamImportBundleParserPort } from '../ports/TeamImportBundleParserPort';
import type { TeamImportFolderPickerPort } from '../ports/TeamImportFolderPickerPort';
import type { TeamImportFolderSourcePort } from '../ports/TeamImportFolderSourcePort';
import type { TeamImportProgressPort } from '../ports/TeamImportProgressPort';
import type {
  TeamImportRawSourcePort,
  TeamImportWebSourcePort,
} from '../ports/TeamImportRawSourcePort';
import type { TeamImportReviewStorePort } from '../ports/TeamImportReviewStorePort';
import type { TeamImportSkillsInstallerPort } from '../ports/TeamImportSkillsInstallerPort';
import type {
  TeamImportPreview,
  TeamImportSourceRequest,
  TeamImportWarning,
} from '@features/team-import/contracts';

/**
 * Sub-agent parse jobs run concurrently up to this cap; each job is its own
 * CLI process, so the cap bounds local process and provider load.
 */
const PARALLEL_PARSE_CONCURRENCY = 4;

async function runWithConcurrencyLimit(
  jobs: readonly (() => Promise<void>)[],
  limit: number
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (nextIndex < jobs.length) {
      const job = jobs[nextIndex];
      nextIndex += 1;
      await job();
    }
  });
  await Promise.all(workers);
}

function validateImportUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('TEAM_IMPORT_VALIDATION:invalidUrl');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    throw new Error('TEAM_IMPORT_VALIDATION:invalidUrl');
  }
  return parsed;
}

export class SmartPreviewTeamImportUseCase {
  constructor(
    private readonly folderPicker: TeamImportFolderPickerPort,
    private readonly deterministicSource: TeamImportFolderSourcePort,
    private readonly rawFolderSource: TeamImportRawSourcePort,
    private readonly webSource: TeamImportWebSourcePort,
    private readonly bundleParser: TeamImportBundleParserPort,
    private readonly skillsInstaller: TeamImportSkillsInstallerPort,
    private readonly reviewStore: TeamImportReviewStorePort
  ) {}

  async execute(
    request: TeamImportSourceRequest,
    progress: TeamImportProgressPort
  ): Promise<TeamImportPreview | null> {
    if (request.kind === 'folder') {
      const selectedFolder = request.folderPath ?? (await this.folderPicker.chooseFolder());
      if (!selectedFolder) return null;

      if (!request.smart) {
        // Deterministic Claude-style parse only; the UI offers a smart retry
        // (with this folder path) when nothing recognizable is found.
        progress.report({ stage: 'reading' });
        const snapshot = await this.deterministicSource.inspect(selectedFolder);
        return this.reviewStore.save(buildTeamImportPreview(snapshot));
      }
      progress.report({ stage: 'reading' });
      const dump = await this.rawFolderSource.readFolder(selectedFolder);
      return this.parseAndStore(dump, selectedFolder, progress);
    }

    const url = validateImportUrl(request.url);
    progress.report({ stage: 'fetching' });
    const dump = await this.webSource.fetchPage(url.toString());
    return this.parseAndStore(dump, '', progress);
  }

  /**
   * The parse stage can run for minutes; report elapsed time every second and
   * the model-output character count whenever any parser job streams more
   * text. `run` may fan out several concurrent parser jobs — each job tracks
   * its own received count and the report shows the aggregate.
   */
  private async withParseProgress<T>(
    progress: TeamImportProgressPort,
    run: (trackedParse: (prompt: string) => Promise<string>) => Promise<T>
  ): Promise<T> {
    const startedAt = Date.now();
    const receivedByJob = new Map<number, number>();
    let nextJobId = 0;
    const reportParsing = (): void => {
      let receivedChars = 0;
      for (const count of receivedByJob.values()) receivedChars += count;
      progress.report({
        stage: 'parsing',
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
        ...(receivedChars > 0 ? { receivedChars } : {}),
      });
    };
    reportParsing();
    const ticker = setInterval(reportParsing, 1000);
    const trackedParse = (prompt: string): Promise<string> => {
      const jobId = nextJobId++;
      return this.bundleParser.parse(prompt, (chars) => {
        receivedByJob.set(jobId, chars);
      });
    };
    try {
      return await run(trackedParse);
    } finally {
      clearInterval(ticker);
    }
  }

  /**
   * Parallel smart parse: one small PLAN job maps the source onto members and
   * skills with file references, then one bounded sub-agent job per entry runs
   * concurrently; verbatim content (memory/skill reference files, lead prompt
   * documents) is copied locally from the dump instead of being echoed by the
   * model. Returns null when the plan phase produces nothing usable — the
   * caller then falls back to the original single-shot extraction.
   */
  private async parseInParallel(
    dump: Awaited<ReturnType<TeamImportRawSourcePort['readFolder']>>,
    trackedParse: (prompt: string) => Promise<string>,
    warnings: TeamImportWarning[]
  ): Promise<string | null> {
    // A transient CLI/API failure of the plan job must not fail the preview —
    // returning null routes the caller to the single-shot fallback.
    let planRaw: string;
    try {
      planRaw = await trackedParse(buildPlanExtractionPrompt(dump));
    } catch {
      return null;
    }
    const plan = parseTeamImportPlan(planRaw);
    if (!plan) return null;

    const skillSlugs = plan.skills.map((skill) => skill.slug);
    const jobs: (() => Promise<void>)[] = [];
    const memberResults: (ReturnType<typeof parseMemberJobOutput> | null)[] = plan.members.map(
      () => null
    );
    const skillResults: (ReturnType<typeof parseSkillJobOutput> | null)[] = plan.skills.map(
      () => null
    );
    plan.members.forEach((member, index) => {
      jobs.push(async () => {
        try {
          const files = selectDumpFiles(dump, member.sourcePaths);
          const raw = await trackedParse(buildMemberExtractionPrompt(member, files, skillSlugs));
          memberResults[index] = parseMemberJobOutput(raw, member);
        } catch {
          memberResults[index] = null;
        }
      });
    });
    plan.skills.forEach((skill, index) => {
      jobs.push(async () => {
        try {
          const files = selectDumpFiles(dump, skill.sourcePaths);
          const raw = await trackedParse(buildSkillExtractionPrompt(skill, files));
          skillResults[index] = parseSkillJobOutput(raw, skill);
        } catch {
          skillResults[index] = null;
        }
      });
    });
    await runWithConcurrencyLimit(jobs, PARALLEL_PARSE_CONCURRENCY);

    const members = memberResults.filter(
      (member): member is NonNullable<typeof member> => member !== null
    );
    const skills = skillResults.filter(
      (skill): skill is NonNullable<typeof skill> => skill !== null
    );
    if (members.length === 0) return null;
    plan.members.forEach((member, index) => {
      if (memberResults[index] === null) {
        warnings.push({
          code: 'bundleMemberDropped',
          name: member.name,
          reason: 'sub-agent parse job failed',
        });
      }
    });
    plan.skills.forEach((skill, index) => {
      if (skillResults[index] === null) {
        warnings.push({
          code: 'bundleSkillDropped',
          slug: skill.slug,
          reason: 'sub-agent parse job failed',
        });
      }
    });
    return assembleBundleJson(plan, members, skills, dump);
  }

  private async parseAndStore(
    dump: Awaited<ReturnType<TeamImportRawSourcePort['readFolder']>>,
    projectPath: string,
    progress: TeamImportProgressPort
  ): Promise<TeamImportPreview> {
    if (dump.files.length === 0) {
      throw new Error('The source did not contain any readable text content.');
    }
    const parallelWarnings: TeamImportWarning[] = [];
    const rawModelOutput = await this.withParseProgress(progress, async (trackedParse) => {
      // Parallel sub-agent pipeline first; fall back to the original
      // single-shot extraction when the plan phase yields nothing usable.
      const assembled = await this.parseInParallel(dump, trackedParse, parallelWarnings);
      if (assembled) return assembled;
      parallelWarnings.length = 0;
      return trackedParse(buildBundleExtractionPrompt(dump));
    });

    progress.report({ stage: 'validating' });
    const {
      bundle,
      warnings: parseWarnings,
      blockingErrors,
    } = parseTeamImportBundle(rawModelOutput);
    const warnings = [...parallelWarnings, ...parseWarnings];
    const truncationWarnings: TeamImportWarning[] = dump.truncated
      ? [{ code: 'bundleSourceTruncated' }]
      : [];

    if (!bundle) {
      return this.reviewStore.save({
        importKind: 'smart',
        suggestedTeamName: 'imported-team',
        projectPath,
        sourceLabel: dump.label,
        members: [],
        skillsFound: [],
        warnings: [...truncationWarnings, ...warnings],
        blockingErrors,
      });
    }

    const existingSkillSlugs = await this.skillsInstaller.listExistingSlugs();
    const preview = bundleToPreview(bundle, {
      projectPath,
      sourceLabel: dump.label,
      existingSkillSlugs,
    });
    return this.reviewStore.save(
      { ...preview, warnings: [...truncationWarnings, ...warnings, ...preview.warnings] },
      bundle
    );
  }
}
