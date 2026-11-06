export const DICTATION_STATUS = 'dictation:status';
export const DICTATION_TRANSCRIBE = 'dictation:transcribe';
export const DICTATION_MAX_SECONDS = 120;
export const DICTATION_SAMPLE_RATE = 16000;
export const DICTATION_MAX_BYTES = 44 + DICTATION_MAX_SECONDS * DICTATION_SAMPLE_RATE * 2;

export interface DictationStatus {
  available: boolean;
  message?: string;
  model?: string;
}

export interface DictationApi {
  getStatus(): Promise<DictationStatus>;
  transcribe(audio: ArrayBuffer): Promise<{ text: string }>;
}
