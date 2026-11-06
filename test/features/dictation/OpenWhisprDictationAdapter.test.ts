// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encodeDictationWav } from '@features/dictation/core/domain/wav';
import { OpenWhisprDictationAdapter } from '@features/dictation/main/infrastructure/OpenWhisprDictationAdapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let root: string;
let bridge: string;
const token = 'a'.repeat(64);
const models = [
  { model: 'tiny', downloaded: true, default: false },
  { model: 'base', downloaded: true, default: true },
];
const json = (data: unknown): Response => new Response(JSON.stringify({ data }));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dictation-test-'));
  bridge = join(root, 'cli-bridge.json');
  await writeFile(bridge, JSON.stringify({ version: 1, port: 8200, token }));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('OpenWhispr local integration', () => {
  it('uses only its authenticated loopback bridge and chooses the downloaded default model', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json(models));
    expect(await new OpenWhisprDictationAdapter(bridge, request).getStatus()).toEqual({
      available: true,
      model: 'base',
    });
    expect(request).toHaveBeenCalledWith(
      'http://127.0.0.1:8200/v1/transcribe/models',
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
      })
    );
  });
  it('does not contact an unvalidated bridge and gives setup guidance when unavailable', async () => {
    const request = vi.fn<typeof fetch>();
    for (const data of [
      { version: 2, port: 8200, token },
      { version: 1, port: 'evil.test', token },
      { version: 1, port: 0, token },
      { version: 1, port: 8200, token: 'bad' },
    ]) {
      await writeFile(bridge, JSON.stringify(data));
      expect((await new OpenWhisprDictationAdapter(bridge, request).getStatus()).available).toBe(
        false
      );
    }
    expect(request).not.toHaveBeenCalled();
  });
  it('asks for a model without falling back to a cloud provider', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json([]));
    const status = await new OpenWhisprDictationAdapter(bridge, request).getStatus();
    expect(status.available).toBe(false);
    expect(status.message).toContain('Download a local speech model');
  });
  it.each([false, true])(
    'cleans up its owned audio after success or failure (failure=%s)',
    async (fail) => {
      let audioPath = '';
      const wav = encodeDictationWav(new Float32Array(1600));
      const request = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
        if (!options?.body) return json(models);
        if (typeof options.body !== 'string') throw new Error('Expected a JSON request');
        const body = JSON.parse(options.body) as { path: string; model: string };
        audioPath = body.path;
        expect(body.model).toBe('base');
        expect(await readFile(audioPath)).toEqual(Buffer.from(wav));
        if (fail) return new Response('', { status: 500 });
        return json({ text: '  Dictated text.  ' });
      });
      const adapter = new OpenWhisprDictationAdapter(bridge, request);
      if (fail) await expect(adapter.transcribe(wav)).rejects.toThrow('OpenWhispr could not');
      else expect(await adapter.transcribe(wav)).toEqual({ text: 'Dictated text.' });
      await expect(stat(audioPath)).rejects.toThrow();
    }
  );
  it('rejects arbitrary file paths at the audio boundary', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      new OpenWhisprDictationAdapter(bridge, request).transcribe(
        'C:\\private.wav' as unknown as ArrayBuffer
      )
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
