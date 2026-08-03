import {
  buildMatterLinkProposalPrompt,
  buildMatterLinkRefreshPrompt,
} from './MatterLinkLeadPrompts';

import type { MatterEvidenceStatusDto, MatterLinkOperationResultDto } from '../../contracts';
import type {
  MatterEvidenceContext,
  MatterEvidenceSourcePort,
} from '../../core/application/ports/MatterEvidenceSourcePort';

export interface MatterLinkLeadNotifier {
  notifyLead(teamName: string, summary: string, text: string): Promise<void>;
}

export interface MatterLinkCoordinatorDeps {
  resolveProjectPath(teamName: string): Promise<string | null>;
  evidenceSource: MatterEvidenceSourcePort;
  leadNotifier: MatterLinkLeadNotifier;
}

export class MatterLinkCoordinator {
  constructor(private readonly deps: MatterLinkCoordinatorDeps) {}

  private async context(teamName: string): Promise<MatterEvidenceContext> {
    return {
      teamName,
      projectPath: await this.deps.resolveProjectPath(teamName),
    };
  }

  async getStatus(teamName: string): Promise<MatterEvidenceStatusDto> {
    return this.deps.evidenceSource.getStatus(await this.context(teamName));
  }

  async initialize(teamName: string): Promise<MatterLinkOperationResultDto> {
    const status = await this.deps.evidenceSource.initialize(await this.context(teamName));
    const accepted =
      status.available &&
      status.state !== 'not-initialized' &&
      status.state !== 'project-unresolved' &&
      status.state !== 'error';
    return {
      operation: 'initialize',
      accepted,
      message: accepted
        ? 'Link was initialized. Check or refresh evidence before generating a proposal.'
        : status.summary,
      status,
    };
  }

  async requestRefresh(teamName: string): Promise<MatterLinkOperationResultDto> {
    const status = await this.getStatus(teamName);
    if (status.state !== 'pending' && status.state !== 'stale') {
      return {
        operation: 'refresh-request',
        accepted: false,
        message:
          status.state === 'ready'
            ? 'Link evidence is already current.'
            : `Link refresh cannot start while the evidence state is ${status.state}.`,
        status,
      };
    }

    await this.deps.leadNotifier.notifyLead(
      teamName,
      'Refresh Link matter evidence',
      buildMatterLinkRefreshPrompt(teamName, status)
    );
    return {
      operation: 'refresh-request',
      accepted: true,
      message: 'The team lead was asked to ingest pending or stale Link sources.',
      status,
    };
  }

  async requestProposal(teamName: string): Promise<MatterLinkOperationResultDto> {
    const status = await this.getStatus(teamName);
    if (!status.queryReady) {
      return {
        operation: 'proposal-request',
        accepted: false,
        message: `Link evidence is not ready for proposal generation (${status.state}).`,
        status,
      };
    }

    try {
      const bundle = await this.deps.evidenceSource.queryDashboardEvidence(
        await this.context(teamName)
      );
      if (bundle.evidence.length === 0) {
        return {
          operation: 'proposal-request',
          accepted: false,
          message: 'Link queries returned no source-backed evidence for the dashboard.',
          status,
          sourceRevision: bundle.sourceRevision,
          evidenceCount: 0,
        };
      }
      await this.deps.leadNotifier.notifyLead(
        teamName,
        'Build Link-backed matter proposal',
        buildMatterLinkProposalPrompt(teamName, bundle)
      );
      return {
        operation: 'proposal-request',
        accepted: true,
        message: 'Bounded Link evidence was sent to the team lead for a review-gated proposal.',
        status,
        sourceRevision: bundle.sourceRevision,
        evidenceCount: bundle.evidence.length,
      };
    } catch (error) {
      return {
        operation: 'proposal-request',
        accepted: false,
        message: error instanceof Error ? error.message : String(error),
        status,
      };
    }
  }
}
