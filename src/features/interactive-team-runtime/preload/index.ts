import {
  type ConsoleTargetDto,
  INTERACTIVE_RUNTIME_CLOSE_CONSOLE,
  INTERACTIVE_RUNTIME_GET_STATUS,
  INTERACTIVE_RUNTIME_LIST_CONSOLE_TARGETS,
  INTERACTIVE_RUNTIME_OPEN_CONSOLE,
  type InteractiveRuntimeStatusDto,
  type InteractiveTeamRuntimeElectronApi,
  type OpenConsoleResultDto,
} from '../contracts';

import type { IpcRenderer } from 'electron';

export type { InteractiveTeamRuntimeElectronApi };

export function createInteractiveTeamRuntimeBridge(
  ipcRenderer: IpcRenderer
): InteractiveTeamRuntimeElectronApi {
  return {
    getStatus: (teamName) =>
      ipcRenderer.invoke(
        INTERACTIVE_RUNTIME_GET_STATUS,
        teamName
      ) as Promise<InteractiveRuntimeStatusDto>,
    listConsoleTargets: (teamName) =>
      ipcRenderer.invoke(INTERACTIVE_RUNTIME_LIST_CONSOLE_TARGETS, teamName) as Promise<
        ConsoleTargetDto[]
      >,
    openConsole: (teamName, memberName) =>
      ipcRenderer.invoke(
        INTERACTIVE_RUNTIME_OPEN_CONSOLE,
        teamName,
        memberName
      ) as Promise<OpenConsoleResultDto>,
    closeConsole: (teamName, viewerSessionName) =>
      ipcRenderer.invoke(
        INTERACTIVE_RUNTIME_CLOSE_CONSOLE,
        teamName,
        viewerSessionName
      ) as Promise<void>,
  };
}
