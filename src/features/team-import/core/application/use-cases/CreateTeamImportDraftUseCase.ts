import { buildAgentFiles, buildWorkflowPointer } from '../../domain/teamImportAgentFilesPolicy';
import { validateTeamImportName } from '../../domain/teamImportPolicy';

import type { TeamImportAgentFilesWriterPort } from '../ports/TeamImportAgentFilesWriterPort';
import type { TeamImportDraftRepositoryPort } from '../ports/TeamImportDraftRepositoryPort';
import type { TeamImportReviewStorePort } from '../ports/TeamImportReviewStorePort';
import type { TeamImportSkillsInstallerPort } from '../ports/TeamImportSkillsInstallerPort';
import type {
  CreateTeamImportDraftRequest,
  CreateTeamImportDraftResult,
  TeamImportBundle,
  TeamImportPreview,
} from '@features/team-import/contracts';

export class CreateTeamImportDraftUseCase {
  constructor(
    private readonly reviewStore: TeamImportReviewStorePort,
    private readonly draftRepository: TeamImportDraftRepositoryPort,
    private readonly agentFilesWriter: TeamImportAgentFilesWriterPort,
    private readonly skillsInstaller: TeamImportSkillsInstallerPort
  ) {}

  async execute(request: CreateTeamImportDraftRequest): Promise<CreateTeamImportDraftResult> {
    const reviewId = request.reviewId.trim();
    if (!reviewId) throw new Error('Import review is required.');

    const teamName = request.teamName.trim();
    const teamNameError = validateTeamImportName(teamName);
    if (teamNameError) throw new Error(`TEAM_IMPORT_VALIDATION:${teamNameError}`);

    const leadName = request.leadName.trim();
    if (!leadName) throw new Error('TEAM_IMPORT_VALIDATION:leadRequired');

    const record = this.reviewStore.consume(reviewId);
    if (!record) throw new Error('This import preview expired. Choose the source again.');
    const { preview, bundle } = record;
    if (preview.blockingErrors.length > 0) {
      throw new Error(preview.blockingErrors[0]);
    }

    const lead = preview.members.find((member) => member.name === leadName);
    if (!lead) {
      this.reviewStore.restore(record);
      throw new Error('TEAM_IMPORT_VALIDATION:leadNotFound');
    }

    const draftPreview = bundle ? this.withPointerWorkflows(preview, bundle, teamName) : preview;
    const draftLead = draftPreview.members.find((member) => member.name === leadName);
    if (!draftLead) {
      this.reviewStore.restore(record);
      throw new Error('TEAM_IMPORT_VALIDATION:leadNotFound');
    }

    try {
      await this.draftRepository.createDraft(teamName, draftPreview, draftLead);
    } catch (error) {
      this.reviewStore.restore(record);
      throw error;
    }

    const applyWarnings = bundle
      ? await this.applyBundleArtifacts(teamName, bundle, preview.projectPath)
      : [];
    return { teamName, ...(applyWarnings.length > 0 ? { applyWarnings } : {}) };
  }

  /**
   * Members are persisted with a short pointer workflow; the full instructions
   * land in the per-agent AGENT.md written right after the team dir exists
   * (createTeamConfig refuses to create a team whose directory already exists,
   * so the files cannot be written first).
   */
  private withPointerWorkflows(
    preview: TeamImportPreview,
    bundle: TeamImportBundle,
    teamName: string
  ): TeamImportPreview {
    const bundleMembers = new Map(bundle.members.map((member) => [member.name, member]));
    return {
      ...preview,
      members: preview.members.map((member) => {
        if (!bundleMembers.has(member.name)) return member;
        const agentDir = this.agentFilesWriter.resolveAgentDir(teamName, member.name);
        return { ...member, workflow: buildWorkflowPointer(agentDir, member.name) };
      }),
    };
  }

  private async applyBundleArtifacts(
    teamName: string,
    bundle: TeamImportBundle,
    projectPath: string
  ): Promise<string[]> {
    const warnings: string[] = [];
    const skillDescriptions = new Map(
      bundle.skills.map((skill) => [skill.slug, skill.description])
    );
    // A team's skills belong to the team, in the app's own store — every import
    // gets its own copy, whether or not the source had a project folder.
    const skillTarget = {
      teamName,
      ...(projectPath.trim() ? { projectPath: projectPath.trim() } : {}),
    };

    for (const member of bundle.members) {
      try {
        await this.agentFilesWriter.writeAgentFiles(
          teamName,
          member.name,
          buildAgentFiles(member, skillDescriptions)
        );
      } catch (error) {
        warnings.push(
          `Agent files for "${member.name}" could not be written: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    for (const skill of bundle.skills) {
      try {
        const result = await this.skillsInstaller.install(skill, skillTarget);
        if (result.status === 'skipped') {
          warnings.push(
            `Skill "${skill.slug}" ${result.detail ?? 'already exists'} and was left untouched.`
          );
        } else if (result.status === 'failed') {
          warnings.push(
            `Skill "${skill.slug}" could not be installed: ${result.detail ?? 'unknown error'}`
          );
        } else if (result.detail) {
          warnings.push(`Skill "${skill.slug}": ${result.detail}.`);
        }
      } catch (error) {
        warnings.push(
          `Skill "${skill.slug}" could not be installed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return warnings;
  }
}
