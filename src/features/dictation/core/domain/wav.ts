import { DICTATION_MAX_BYTES, DICTATION_SAMPLE_RATE } from '../../contracts';

/** Canonical mono PCM WAV, used across the renderer/main trust boundary. */
export function encodeDictationWav(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const word = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  word(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  word(8, 'WAVE');
  word(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, DICTATION_SAMPLE_RATE, true);
  view.setUint32(28, DICTATION_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  word(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] || 0));
    view.setInt16(44 + i * 2, sample * (sample < 0 ? 0x8000 : 0x7fff), true);
  }
  return buffer;
}

export function validateDictationWav(audio: unknown): asserts audio is ArrayBuffer {
  if (
    !(audio instanceof ArrayBuffer) ||
    audio.byteLength < 46 ||
    audio.byteLength > DICTATION_MAX_BYTES
  ) {
    throw new Error('Recording must contain between a moment and two minutes of audio.');
  }
  const view = new DataView(audio);
  const word = (offset: number, value: string): boolean =>
    [...value].every((char, index) => view.getUint8(offset + index) === char.charCodeAt(0));
  if (
    !word(0, 'RIFF') ||
    !word(8, 'WAVE') ||
    !word(12, 'fmt ') ||
    !word(36, 'data') ||
    view.getUint32(4, true) !== audio.byteLength - 8 ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== DICTATION_SAMPLE_RATE ||
    view.getUint32(28, true) !== DICTATION_SAMPLE_RATE * 2 ||
    view.getUint16(32, true) !== 2 ||
    view.getUint16(34, true) !== 16 ||
    view.getUint32(40, true) !== audio.byteLength - 44 ||
    (audio.byteLength - 44) % 2 !== 0
  ) {
    throw new Error('Invalid dictation audio. Please record again.');
  }
}
