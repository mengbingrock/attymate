import { DICTATION_STATUS, DICTATION_TRANSCRIBE } from '../contracts';

import type { DictationApi } from '../contracts';
import type { IpcRenderer } from 'electron';

export function createDictationBridge(ipc: IpcRenderer): DictationApi {
  return {
    getStatus: () => ipc.invoke(DICTATION_STATUS),
    transcribe: (audio) => ipc.invoke(DICTATION_TRANSCRIBE, audio),
  };
}
