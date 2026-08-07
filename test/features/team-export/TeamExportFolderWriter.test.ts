import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { TeamExportFolderWriter } from '@features/team-export/main';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as yauzl from 'yauzl';

let destination: string;

const FILES = [
  { relativePath: 'team-import-bundle.json', content: '{"schema":"team-import-bundle/v1"}\n' },
  { relativePath: 'agents/calendar-agent.md', content: '---\nname: calendar-agent\n---\n\nWork.\n' },
  { relativePath: 'skills/legal-calendaring-workflow/SKILL.md', content: 'skill\n' },
];

async function listZipEntries(zipPath: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const entries: string[] = [];
    // Entry names only, from an archive this test wrote moments earlier —
    // nothing is extracted to disk.
    // eslint-disable-next-line sonarjs/no-unsafe-unzip
    yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error instanceof Error ? error : new Error('zip could not be opened'));
        return;
      }
      zipFile.on('entry', (entry: { fileName: string }) => {
        entries.push(entry.fileName);
        zipFile.readEntry();
      });
      zipFile.on('end', () => resolve(entries));
      zipFile.on('error', (zipError: unknown) => {
        reject(zipError instanceof Error ? zipError : new Error(String(zipError)));
      });
      zipFile.readEntry();
    });
  });
}

beforeEach(async () => {
  destination = await fs.mkdtemp(path.join(os.tmpdir(), 'team-export-writer-'));
});

afterEach(async () => {
  await fs.rm(destination, { recursive: true, force: true });
});

describe('TeamExportFolderWriter', () => {
  it('writes every file, creating nested directories', async () => {
    const result = await new TeamExportFolderWriter().write({
      destinationPath: destination,
      folderName: 'ca-team-export',
      files: FILES,
      overwrite: false,
    });

    expect(result.folderPath).toBe(path.join(destination, 'ca-team-export'));
    for (const file of FILES) {
      await expect(
        fs.readFile(path.join(result.folderPath, file.relativePath), 'utf8')
      ).resolves.toBe(file.content);
    }
  });

  it('writes a zip beside the folder holding the same entries', async () => {
    const result = await new TeamExportFolderWriter().write({
      destinationPath: destination,
      folderName: 'ca-team-export',
      files: FILES,
      overwrite: false,
    });

    expect(result.zipPath).toBe(path.join(destination, 'ca-team-export.zip'));
    expect(result.zipError).toBeUndefined();
    await expect(listZipEntries(result.zipPath!)).resolves.toEqual(
      FILES.map((file) => file.relativePath)
    );
  });

  it('refuses to write over a non-empty folder unless overwrite is confirmed', async () => {
    const folderPath = path.join(destination, 'ca-team-export');
    await fs.mkdir(folderPath, { recursive: true });
    await fs.writeFile(path.join(folderPath, 'existing.txt'), 'keep me', 'utf8');
    const writer = new TeamExportFolderWriter();

    await expect(
      writer.write({
        destinationPath: destination,
        folderName: 'ca-team-export',
        files: FILES,
        overwrite: false,
      })
    ).rejects.toThrow(/already exists/);

    await expect(
      writer.write({
        destinationPath: destination,
        folderName: 'ca-team-export',
        files: FILES,
        overwrite: true,
      })
    ).resolves.toMatchObject({ folderPath });
  });

  it('refuses a file path that would escape the export folder', async () => {
    await expect(
      new TeamExportFolderWriter().write({
        destinationPath: destination,
        folderName: 'ca-team-export',
        files: [{ relativePath: '../escape.md', content: 'nope' }],
        overwrite: false,
      })
    ).rejects.toThrow(/outside the export folder/);
  });
});
