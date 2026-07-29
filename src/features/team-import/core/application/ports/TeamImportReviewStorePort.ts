import type { TeamImportBundle, TeamImportPreview } from '@features/team-import/contracts';

export interface TeamImportReviewRecord {
  preview: TeamImportPreview;
  bundle?: TeamImportBundle;
}

export interface TeamImportReviewStorePort {
  save(preview: Omit<TeamImportPreview, 'reviewId'>, bundle?: TeamImportBundle): TeamImportPreview;
  consume(reviewId: string): TeamImportReviewRecord | null;
  restore(record: TeamImportReviewRecord): void;
}
