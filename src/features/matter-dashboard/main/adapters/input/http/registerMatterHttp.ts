import { createLogger } from '@shared/utils/logger';

import { MATTER_ROUTE, type MatterSnapshotDto } from '../../../../contracts';

import type { MatterFeatureFacade } from '../../../composition/createMatterFeature';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('Feature:Matter:HTTP');

const EMPTY_SNAPSHOT: MatterSnapshotDto = { matter: null, proposal: null };

function readTeamName(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
}
