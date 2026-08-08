import { createLogger } from '@shared/utils/logger';

import {
  MATTER_ROUTE,
  normalizeMatterChanges,
  type MatterEvidenceStatusDto,
  type MatterLinkOperation,
  type MatterLinkOperationResultDto,
  type MatterRefreshResultDto,
  type MatterSnapshotDto,
} from '../../../../contracts';

import type { MatterFeatureFacade } from '../../../composition/createMatterFeature';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('Feature:Matter:HTTP');

const EMPTY_SNAPSHOT: MatterSnapshotDto = { matters: [], linkedMatterIds: [], proposal: null };

function linkStatusError(summary: string): MatterEvidenceStatusDto {
  return {
    source: 'link',
    checkedAt: new Date().toISOString(),
    projectPath: null,
    state: 'error',
    available: false,
    queryReady: false,
    summary,
    counts: {
      sourceFiles: 0,
      sourcePages: 0,
      representedFiles: 0,
      pendingFiles: 0,
      staleFiles: 0,
      secretWarnings: 0,
    },
  };
}

function linkOperationError(
  operation: MatterLinkOperation,
  summary: string
): MatterLinkOperationResultDto {
  return {
    operation,
    accepted: false,
    message: summary,
    status: linkStatusError(summary),
  };
}

function readTeamName(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readOptionalId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function registerMatterHttp(app: FastifyInstance, feature: MatterFeatureFacade): void {
  app.get<{ Querystring: { teamName?: string } }>(
    MATTER_ROUTE,
    async (request): Promise<MatterSnapshotDto> => {
      const teamName = readTeamName(request.query?.teamName);
      if (!teamName) return EMPTY_SNAPSHOT;
      try {
        return await feature.getSnapshot(teamName);
      } catch (error) {
        logger.error('Failed to load matter snapshot via HTTP', error);
        return EMPTY_SNAPSHOT;
      }
    }
  );

  const linkOperationRoutes: {
    path: string;
    operation: MatterLinkOperation;
    run: (teamName: string, matterId?: string) => Promise<MatterLinkOperationResultDto>;
  }[] = [
    {
      path: 'link-initialize',
      operation: 'initialize',
      run: (teamName) => feature.initializeLink(teamName),
    },
    {
      path: 'link-refresh',
      operation: 'refresh-request',
      run: (teamName) => feature.requestLinkRefresh(teamName),
    },
    {
      path: 'link-proposal',
      operation: 'proposal-request',
      run: (teamName, matterId) => feature.requestLinkProposal(teamName, matterId),
    },
  ];
  for (const route of linkOperationRoutes) {
    app.post<{ Body: { teamName?: string; matterId?: string } }>(
      `${MATTER_ROUTE}/${route.path}`,
      async (request, reply): Promise<MatterLinkOperationResultDto> => {
        const teamName = readTeamName(request.body?.teamName);
        if (!teamName) {
          void reply.status(400);
          return linkOperationError(route.operation, 'teamName is required');
        }
        try {
          return await route.run(teamName, readOptionalId(request.body?.matterId));
        } catch (error) {
          logger.error(`Failed to run matter ${route.operation} via HTTP`, error);
          void reply.status(500);
          return linkOperationError(route.operation, 'Link matter operation failed.');
        }
      }
    );
  }

  app.get<{ Querystring: { teamName?: string } }>(
    `${MATTER_ROUTE}/link-status`,
    async (request, reply): Promise<MatterEvidenceStatusDto> => {
      const teamName = readTeamName(request.query?.teamName);
      if (!teamName) {
        void reply.status(400);
        return linkStatusError('teamName is required');
      }
      try {
        return await feature.getLinkStatus(teamName);
      } catch (error) {
        logger.error('Failed to load Link matter evidence status via HTTP', error);
        void reply.status(500);
        return linkStatusError('Link matter evidence status could not be loaded.');
      }
    }
  );

  app.post<{ Body: { teamName?: string; matterId?: string } }>(
    `${MATTER_ROUTE}/request-refresh`,
    async (request, reply): Promise<MatterRefreshResultDto> => {
      const teamName = readTeamName(request.body?.teamName);
      if (!teamName) {
        void reply.status(400);
        return {
          accepted: false,
          mode: 'update',
          message: 'teamName is required',
          usedInstalledSkill: false,
        };
      }
      try {
        return await feature.requestDashboardRefresh(
          teamName,
          readOptionalId(request.body?.matterId)
        );
      } catch (error) {
        logger.error('Failed to request a matter dashboard refresh via HTTP', error);
        void reply.status(500);
        return {
          accepted: false,
          mode: 'update',
          message: 'The dashboard refresh request could not be delivered.',
          usedInstalledSkill: false,
        };
      }
    }
  );

  app.post<{ Body: { teamName?: string } }>(
    `${MATTER_ROUTE}/apply-proposal`,
    async (request, reply): Promise<MatterSnapshotDto> => {
      const teamName = readTeamName(request.body?.teamName);
      if (!teamName) {
        void reply.status(400);
        return EMPTY_SNAPSHOT;
      }
      try {
        return await feature.applyProposal(teamName);
      } catch (error) {
        logger.error('Failed to apply matter proposal via HTTP', error);
        void reply.status(500);
        return EMPTY_SNAPSHOT;
      }
    }
  );

  app.post<{ Body: { teamName?: string; reason?: string } }>(
    `${MATTER_ROUTE}/reject-proposal`,
    async (request, reply): Promise<MatterSnapshotDto> => {
      const teamName = readTeamName(request.body?.teamName);
      if (!teamName) {
        void reply.status(400);
        return EMPTY_SNAPSHOT;
      }
      try {
        return await feature.rejectProposal(
          teamName,
          typeof request.body?.reason === 'string' && request.body.reason.trim()
            ? request.body.reason.trim()
            : undefined
        );
      } catch (error) {
        logger.error('Failed to reject matter proposal via HTTP', error);
        void reply.status(500);
        return EMPTY_SNAPSHOT;
      }
    }
  );

  app.post<{ Body: { teamName?: string; matterId?: string; changes?: unknown } }>(
    `${MATTER_ROUTE}/update`,
    async (request, reply): Promise<MatterSnapshotDto> => {
      const teamName = readTeamName(request.body?.teamName);
      const matterId = readOptionalId(request.body?.matterId);
      if (!teamName || !matterId) {
        void reply.status(400);
        return EMPTY_SNAPSHOT;
      }
      try {
        return await feature.updateMatter(
          teamName,
          matterId,
          normalizeMatterChanges(request.body?.changes)
        );
      } catch (error) {
        logger.error('Failed to update matter via HTTP', error);
        void reply.status(500);
        return EMPTY_SNAPSHOT;
      }
    }
  );

  app.post<{ Body: { teamName?: string; caption?: string } }>(
    `${MATTER_ROUTE}/create`,
    async (request, reply): Promise<MatterSnapshotDto> => {
      const teamName = readTeamName(request.body?.teamName);
      if (!teamName) {
        void reply.status(400);
        return EMPTY_SNAPSHOT;
      }
      try {
        const caption = readOptionalId(request.body?.caption);
        return await feature.createMatter(teamName, caption ? { caption } : undefined);
      } catch (error) {
        logger.error('Failed to create matter via HTTP', error);
        void reply.status(500);
        return EMPTY_SNAPSHOT;
      }
    }
  );

  for (const [routePath, run] of [
    ['link-team', (teamName: string, matterId: string) => feature.linkTeam(teamName, matterId)],
    ['unlink-team', (teamName: string, matterId: string) => feature.unlinkTeam(teamName, matterId)],
  ] as const) {
    app.post<{ Body: { teamName?: string; matterId?: string } }>(
      `${MATTER_ROUTE}/${routePath}`,
      async (request, reply): Promise<MatterSnapshotDto> => {
        const teamName = readTeamName(request.body?.teamName);
        const matterId = readOptionalId(request.body?.matterId);
        if (!teamName || !matterId) {
          void reply.status(400);
          return EMPTY_SNAPSHOT;
        }
        try {
          return await run(teamName, matterId);
        } catch (error) {
          logger.error(`Failed matter ${routePath} via HTTP`, error);
          void reply.status(500);
          return EMPTY_SNAPSHOT;
        }
      }
    );
  }
}
