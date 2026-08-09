import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { isPathWithinRoot, validateFileName } from '@main/utils/pathValidation';
import { shell } from 'electron';

import { resolveWritableSkillRoot } from './resolveWritableSkillRoot';
import { SkillImportService } from './SkillImportService';
import { SkillPlanService } from './SkillPlanService';
import { SkillProjectionService } from './SkillProjectionService';
import { SkillRootsResolver } from './SkillRootsResolver';
import { SkillScaffoldService } from './SkillScaffoldService';
import { SkillsCatalogService } from './SkillsCatalogService';

import type {
  SkillDeleteRequest,
  SkillDetail,
  SkillImportRequest,
  SkillReviewPreview,
  SkillUpsertRequest,
} from '@shared/types/extensions';

export class SkillsMutationService {
  constructor(
    private readonly rootsResolver = new SkillRootsResolver(),
    private readonly catalogService = new SkillsCatalogService(),
    private readonly scaffoldService = new SkillScaffoldService(rootsResolver),
    private readonly importService = new SkillImportService(),
    private readonly planService = new SkillPlanService(),
    private readonly projectionService = new SkillProjectionService(rootsResolver)
  ) {}

  async previewUpsert(request: SkillUpsertRequest): Promise<SkillReviewPreview> {
    const targetSkillDir = await this.scaffoldService.resolveUpsertTarget(
      request.scope,
      request.rootKind,
      request.projectPath,
      request.folderName,
      request.existingSkillId,
      request.teamName
    );
    const files = this.scaffoldService.normalizeDraftFiles(request.files);
    const plan = await this.planService.buildUpsertPlan(targetSkillDir, files);
    return plan.preview;
  }

  async applyUpsert(request: SkillUpsertRequest): Promise<SkillDetail | null> {
    if (!request.reviewPlanId) {
      throw new Error('Review the skill changes before saving.');
    }

    const targetSkillDir = await this.scaffoldService.resolveUpsertTarget(
      request.scope,
      request.rootKind,
      request.projectPath,
      request.folderName,
      request.existingSkillId,
      request.teamName
    );
    const files = this.scaffoldService.normalizeDraftFiles(request.files);
    const plan = await this.planService.buildUpsertPlan(targetSkillDir, files);
    this.assertReviewedPlanMatches(request.reviewPlanId, plan.preview.planId);
    await this.planService.applyPlan(plan);
    await this.projectIfLibraryScoped(request.scope, targetSkillDir);

    return this.catalogService.getDetail(targetSkillDir, {
      projectPath: request.projectPath,
      teamName: request.teamName,
    });
  }

  /**
   * A canonical skill is invisible to the CLIs until the app points their own
   * skill folders at it. Library skills are pointed at machine-wide; team
   * skills are projected by the team runtime for the duration of a run.
   */
  private async projectIfLibraryScoped(
    scope: SkillUpsertRequest['scope'],
    targetSkillDir: string
  ): Promise<void> {
    if (scope !== 'library') return;
    try {
      await this.projectionService.project(targetSkillDir, path.basename(targetSkillDir));
    } catch {
      // A missing pointer degrades discovery, never the save itself.
    }
  }

  async previewImport(request: SkillImportRequest): Promise<SkillReviewPreview> {
    const { sourceDir, targetSkillDir } = await this.resolveImportTarget(request);
    const inspection = await this.importService.inspectSourceDir(sourceDir);
    const plan = await this.planService.buildImportPlan(targetSkillDir, inspection.files);
    return {
      ...plan.preview,
      warnings: [...new Set([...inspection.warnings, ...plan.preview.warnings])],
    };
  }

  async applyImport(request: SkillImportRequest): Promise<SkillDetail | null> {
    if (!request.reviewPlanId) {
      throw new Error('Review the import changes before saving.');
    }

    const { sourceDir, targetSkillDir } = await this.resolveImportTarget(request);
    const inspection = await this.importService.inspectSourceDir(sourceDir);
    const plan = await this.planService.buildImportPlan(targetSkillDir, inspection.files);
    this.assertReviewedPlanMatches(request.reviewPlanId, plan.preview.planId);
    await this.planService.applyPlan(plan);
    await this.projectIfLibraryScoped(request.scope, targetSkillDir);

    return this.catalogService.getDetail(targetSkillDir, {
      projectPath: request.projectPath,
      teamName: request.teamName,
    });
  }

  async deleteSkill(request: SkillDeleteRequest): Promise<void> {
    const skillDir = this.resolveExistingSkill(
      request.skillId,
      request.projectPath,
      request.teamName
    );
    // Drop the pointers first: a dangling symlink in a CLI folder is worse
    // than none, and release only removes links we installed ourselves.
    await this.projectionService.release(path.basename(skillDir), skillDir).catch(() => undefined);
    await shell.trashItem(skillDir);
  }

  private async resolveImportTarget(
    request: SkillImportRequest
  ): Promise<{ sourceDir: string; targetSkillDir: string }> {
    const sourceDir = await this.importService.validateSourceDir(request.sourceDir);

    const root = resolveWritableSkillRoot(this.rootsResolver, {
      scope: request.scope,
      rootKind: request.rootKind,
      projectPath: request.projectPath,
      teamName: request.teamName,
    });
    await fs.mkdir(root.rootPath, { recursive: true });

    const folderName = request.folderName?.trim() || path.basename(sourceDir);
    const folderValidation = validateFileName(folderName);
    if (!folderValidation.valid) {
      throw new Error(folderValidation.error ?? 'Invalid folder name');
    }

    const targetSkillDir = path.join(root.rootPath, folderName);
    if (!isPathWithinRoot(targetSkillDir, root.rootPath)) {
      throw new Error('Import destination is outside the allowed root');
    }

    return { sourceDir, targetSkillDir };
  }

  private resolveExistingSkill(skillId: string, projectPath?: string, teamName?: string): string {
    const normalizedSkillDir = path.resolve(skillId);
    const roots = this.rootsResolver.resolve({ projectPath, teamName });
    const owningRoot = roots.find((root) => isPathWithinRoot(normalizedSkillDir, root.rootPath));
    if (!owningRoot) {
      throw new Error('Skill is outside the allowed roots');
    }
    return normalizedSkillDir;
  }

  private assertReviewedPlanMatches(reviewPlanId: string, currentPlanId: string): void {
    if (reviewPlanId !== currentPlanId) {
      throw new Error(
        'The skill files changed after review. Review the latest changes and try again.'
      );
    }
  }
}
