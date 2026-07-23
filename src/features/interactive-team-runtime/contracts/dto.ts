export interface InteractiveRuntimeStatusDto {
  /** True when this team runs the interactive tmux lead runtime. */
  active: boolean;
  tmuxSessionName?: string;
  leadSessionId?: string;
  sessionTeamName?: string;
}

export interface ConsoleTargetDto {
  /** Roster member name; the lead uses its configured lead name. */
  memberName: string;
  isLead: boolean;
  paneId: string;
  windowIndex: number;
}

export interface OpenConsoleResultDto {
  /** Spawn spec for the renderer PTY (api.terminal.spawn). */
  command: string;
  args: string[];
  /** Viewer tmux session backing this console; pass back on close. */
  viewerSessionName: string;
}

export interface InteractiveTeamRuntimeElectronApi {
  getStatus(teamName: string): Promise<InteractiveRuntimeStatusDto>;
  listConsoleTargets(teamName: string): Promise<ConsoleTargetDto[]>;
  openConsole(teamName: string, memberName: string): Promise<OpenConsoleResultDto>;
  closeConsole(teamName: string, viewerSessionName: string): Promise<void>;
}
