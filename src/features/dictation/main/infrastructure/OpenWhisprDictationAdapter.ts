import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateDictationWav } from '../../core/domain/wav';

import type { DictationApi, DictationStatus } from '../../contracts';

interface Bridge {
  port: number;
  token: string;
}
interface LocalModel {
  model: string;
  downloaded: boolean;
  default: boolean;
}

export class OpenWhisprDictationAdapter implements DictationApi {
  private busy = false;

  constructor(
    private readonly bridgePath = join(homedir(), '.openwhispr', 'cli-bridge.json'),
    private readonly request: typeof fetch = fetch
  ) {}

  private async readBridge(): Promise<Bridge> {
    const raw = await readFile(this.bridgePath, 'utf8');
    if (raw.length > 4096) throw new Error('Invalid OpenWhispr bridge. Restart OpenWhispr.');
    const bridge = JSON.parse(raw) as Record<string, unknown>;
    if (
      bridge.version !== 1 ||
      typeof bridge.port !== 'number' ||
      !Number.isInteger(bridge.port) ||
      bridge.port < 1 ||
      bridge.port > 65535 ||
      typeof bridge.token !== 'string' ||
      !/^[a-f\d]{64}$/i.test(bridge.token)
    ) {
      throw new Error('Unsupported OpenWhispr bridge. Update or restart OpenWhispr.');
    }
    return { port: bridge.port, token: bridge.token };
  }

  private async call(bridge: Bridge, endpoint: string, body?: object): Promise<unknown> {
    const response = await this.request(`http://127.0.0.1:${bridge.port}/v1/${endpoint}`, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(body ? 120000 : 3000),
    });
    if (!response.ok)
      throw new Error(
        'OpenWhispr could not process the recording. Check its local model and try again.'
      );
    const result = (await response.json()) as { data?: unknown };
    return result.data;
  }

  private async selectModel(bridge: Bridge): Promise<string | null> {
    const data = await this.call(bridge, 'transcribe/models');
    if (!Array.isArray(data)) throw new Error('Update OpenWhispr to enable local dictation.');
    const models = (data as unknown[]).filter(
      (item): item is LocalModel =>
        typeof item === 'object' &&
        item !== null &&
        'model' in item &&
        typeof item.model === 'string' &&
        'downloaded' in item &&
        item.downloaded === true
    );
    return (models.find((model) => model.default) ?? models[0])?.model ?? null;
  }

  async getStatus(): Promise<DictationStatus> {
    try {
      const bridge = await this.readBridge();
      const model = await this.selectModel(bridge);
      return model
        ? { available: true, model }
        : {
            available: false,
            message:
              'Download a local speech model in OpenWhispr, then try again. Its Base model is a good starting point.',
          };
    } catch {
      return {
        available: false,
        message:
          'Start OpenWhispr to use dictation. A recent version with the local transcription API is required.',
      };
    }
  }

  async transcribe(audio: ArrayBuffer): Promise<{ text: string }> {
    validateDictationWav(audio);
    if (this.busy) throw new Error('Another recording is being transcribed. Please wait.');
    this.busy = true;
    let directory: string | undefined;
    try {
      const bridge = await this.readBridge();
      const model = await this.selectModel(bridge);
      if (!model) throw new Error('Download a local speech model in OpenWhispr first.');
      directory = await mkdtemp(join(tmpdir(), 'attymate-dictation-'));
      const path = join(directory, 'recording.wav');
      await writeFile(path, new Uint8Array(audio), { mode: 0o600 });
      const result = (await this.call(bridge, 'transcribe', { path, model })) as {
        text?: unknown;
      } | null;
      if (!result || typeof result.text !== 'string' || result.text.length > 100000) {
        throw new Error('OpenWhispr returned an invalid transcript. Please try again.');
      }
      return { text: result.text.trim() };
    } finally {
      try {
        if (directory) await rm(directory, { recursive: true, force: true });
      } finally {
        this.busy = false;
      }
    }
  }
}
