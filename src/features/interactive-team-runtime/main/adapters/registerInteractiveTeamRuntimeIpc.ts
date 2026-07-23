import {
  INTERACTIVE_RUNTIME_CLOSE_CONSOLE,
  INTERACTIVE_RUNTIME_GET_STATUS,
  INTERACTIVE_RUNTIME_LIST_CONSOLE_TARGETS,
  INTERACTIVE_RUNTIME_OPEN_CONSOLE,
} from '../../contracts';

import type { InteractiveTeamRuntimeService } from '../InteractiveTeamRuntimeService';
import type { IpcMain } from 'electron';

function asTrimmedString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

export function registerInteractiveTeamRuntimeIpc(
  ipcMain: IpcMain,
  service: InteractiveTeamRuntimeService
): void {
  ipcMain.handle(INTERACTIVE_RUNTIME_GET_STATUS, async (_event, teamName: unknown) => {
    return service.getStatus(asTrimmedString(teamName, 'teamName'));
  });

  ipcMain.handle(INTERACTIVE_RUNTIME_LIST_CONSOLE_TARGETS, async (_event, teamName: unknown) => {
    return service.listConsoleTargets(asTrimmedString(teamName, 'teamName'));
  });

  ipcMain.handle(
    INTERACTIVE_RUNTIME_OPEN_CONSOLE,
    async (_event, teamName: unknown, memberName: unknown) => {
      return service.openConsole(
        asTrimmedString(teamName, 'teamName'),
        asTrimmedString(memberName, 'memberName')
      );
    }
  );

  ipcMain.handle(
    INTERACTIVE_RUNTIME_CLOSE_CONSOLE,
    async (_event, teamName: unknown, viewerSessionName: unknown) => {
      await service.closeConsole(
        asTrimmedString(teamName, 'teamName'),
        asTrimmedString(viewerSessionName, 'viewerSessionName')
      );
    }
  );
}
