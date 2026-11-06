import { DICTATION_STATUS, DICTATION_TRANSCRIBE } from '../contracts';

import { OpenWhisprDictationAdapter } from './infrastructure/OpenWhisprDictationAdapter';

import type { IpcMain } from 'electron';

export function registerDictationIpc(ipcMain: IpcMain): void {
  const adapter = new OpenWhisprDictationAdapter();
  ipcMain.handle(DICTATION_STATUS, () => adapter.getStatus());
  ipcMain.handle(DICTATION_TRANSCRIBE, (_event, audio: unknown) =>
    adapter.transcribe(audio as ArrayBuffer)
  );
}
