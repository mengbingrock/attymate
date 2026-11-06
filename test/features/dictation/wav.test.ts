// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { DICTATION_MAX_BYTES } from '@features/dictation/contracts';
import { encodeDictationWav, validateDictationWav } from '@features/dictation/core/domain/wav';

describe('dictation audio boundary', () => {
  it('encodes mono 16kHz PCM and clips samples to valid amplitudes', () => {
    const wav = encodeDictationWav(new Float32Array([-2, 0, 2]));
    expect(() => validateDictationWav(wav)).not.toThrow();
    const view = new DataView(wav);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(32767);
  });
  it('rejects empty, oversized, compressed, stereo, truncated, and malformed recordings', () => {
    for (const input of [
      null,
      'path/to/audio.wav',
      new ArrayBuffer(0),
      new ArrayBuffer(DICTATION_MAX_BYTES + 1),
    ]) {
      expect(() => validateDictationWav(input)).toThrow();
    }
    for (const offset of [0, 4, 16, 20, 22, 24, 28, 32, 34, 36, 40]) {
      const wav = encodeDictationWav(new Float32Array(100));
      new DataView(wav).setUint8(offset, 255);
      expect(() => validateDictationWav(wav)).toThrow();
    }
  });
});
