import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { atomicWriteAsync } from '@main/utils/atomicWrite';
import { isPathWithinRoot } from '@main/utils/pathValidation';
import { createLogger } from '@shared/utils/logger';
import * as yazl from 'yazl';

import type {
  TeamExportWriteResult,
  TeamExportWriterPort,
} from '../../core/application/ports/TeamExportPorts';
import type { TeamExportFile } from '../../core/domain/teamExportPolicy';

const logger = createLogger('Feature:TeamExport:Writer');

async function isNonEmptyDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await fs.readdir(dirPath)).length > 0;
  } catch {
    return false;
  }
}

/**
 * Writes the export folder, then a .zip beside it.
 *
 * The folder is the artifact that matters — it is what Import Team reads — so a
 * zip failure is reported but never fails the export.
 */
export class TeamExportFolderWriter implements TeamExportWriterPort {
  async write(input: {
    destinationPath: string;
    folderName: string;
    files: readonly TeamExportFile[];
    overwrite: boolean;
  }): Promise<TeamExportWriteResult> {
    const folderPath = path.join(input.destinationPath, input.folderName);
    if (!input.overwrite && (await isNonEmptyDirectory(folderPath))) {
      throw new Error(
        `${folderPath} already exists and is not empty. Choose another destination or confirm overwrite.`
      );
    }

    await fs.mkdir(folderPath, { recursive: true });
    for (const file of input.files) {
      const target = path.join(folderPath, file.relativePath);
      if (!isPathWithinRoot(target, folderPath)) {
        throw new Error(`Refusing to write outside the export folder: ${file.relativePath}`);
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await atomicWriteAsync(target, file.content);
    }

    try {
      const zipPath = await this.writeZip(`${folderPath}.zip`, input.files);
      return { folderPath, zipPath };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn('Team export folder written, but the archive failed', error);
      return { folderPath, zipPath: null, zipError: reason };
    }
  }

  private async writeZip(zipPath: string, files: readonly TeamExportFile[]): Promise<string> {
    const zipFile = new yazl.ZipFile();
    for (const file of files) {
      zipFile.addBuffer(Buffer.from(file.content, 'utf8'), file.relativePath);
    }
    zipFile.end();

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      zipFile.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
      zipFile.outputStream.on('error', reject);
      zipFile.outputStream.on('end', () => resolve());
    });
    await atomicWriteAsync(zipPath, Buffer.concat(chunks));
    return zipPath;
  }
}
