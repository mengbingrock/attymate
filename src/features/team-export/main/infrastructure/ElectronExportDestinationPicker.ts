import { dialog } from 'electron';

import type { TeamExportDestinationPickerPort } from '../../core/application/ports/TeamExportPorts';

/** Native folder picker for the export destination. */
export class ElectronExportDestinationPicker implements TeamExportDestinationPickerPort {
  async chooseDestination(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: 'Export team to…',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Export here',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  }
}
