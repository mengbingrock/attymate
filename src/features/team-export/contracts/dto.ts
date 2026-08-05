export type TeamExportWarning =
  | { code: 'memberSkipped'; name: string; reason: string }
  | { code: 'skillMissing'; slug: string; requestedBy: string }
  | { code: 'skillTooLarge'; slug: string; reason: string }
  | { code: 'memberLimitExceeded'; dropped: number; limit: number }
  | { code: 'skillLimitExceeded'; dropped: number; limit: number }
  | { code: 'zipFailed'; reason: string };

export interface TeamExportRequest {
  teamName: string;
  /** Destination directory; omitted means "ask the user to pick one". */
  destinationPath?: string;
  /** Overwrite an existing export folder of the same name. */
  overwrite?: boolean;
}

export interface TeamExportResult {
  exported: boolean;
  /** Absolute path of the written folder, null when nothing was written. */
  folderPath: string | null;
  /** Absolute path of the archive, null when zipping was skipped or failed. */
  zipPath: string | null;
  memberCount: number;
  skillSlugs: string[];
  warnings: TeamExportWarning[];
  message: string;
}
