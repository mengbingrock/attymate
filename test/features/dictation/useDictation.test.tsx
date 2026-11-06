import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { useDictation } from '@features/dictation/renderer/hooks/useDictation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ status: vi.fn(), transcribe: vi.fn(), record: vi.fn() }));
vi.mock('@renderer/api', () => ({
  isElectronMode: () => true,
  api: { dictation: { getStatus: mocks.status, transcribe: mocks.transcribe } },
}));
vi.mock('@features/dictation/renderer/adapters/recording', () => ({
  startDictationRecording: mocks.record,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let controller: ReturnType<typeof useDictation>;
let field: HTMLTextAreaElement;
let root: ReturnType<typeof createRoot>;
const command = vi.fn().mockReturnValue(true);
const active = { stop: vi.fn(), cancel: vi.fn() };
function Harness() {
  controller = useDictation();
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.status.mockResolvedValue({ available: true });
  mocks.transcribe.mockResolvedValue({ text: 'Dictated text.' });
  active.stop.mockResolvedValue(new ArrayBuffer(46));
  mocks.record.mockResolvedValue(active);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: command });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    }
  );
  const host = document.createElement('div');
  document.body.append(host);
  field = document.createElement('textarea');
  document.body.append(field);
  root = createRoot(host);
  await act(() => Promise.resolve(root.render(<Harness />)));
  await act(() => Promise.resolve(field.focus()));
});
afterEach(async () => {
  await act(() => Promise.resolve(root.unmount()));
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('dictation lifecycle', () => {
  it('records, transcribes, inserts, and releases its microphone', async () => {
    await act(async () => {
      await controller.start();
    });
    expect(controller.phase).toBe('recording');
    await act(async () => {
      await controller.stop();
    });
    expect(command).toHaveBeenCalledWith('insertText', false, 'Dictated text.');
    expect(active.cancel).toHaveBeenCalledOnce();
    expect(controller.phase).toBe('idle');
  });
  it('releases microphone access that arrives after cancellation', async () => {
    const pending = deferred<typeof active>();
    mocks.record.mockReturnValue(pending.promise);
    let starting!: Promise<void>;
    await act(() => {
      starting = controller.start();
      return Promise.resolve();
    });
    await act(async () => {
      controller.cancel();
      pending.resolve(active);
      await starting;
    });
    expect(active.cancel).toHaveBeenCalledOnce();
    expect(controller.phase).toBe('idle');
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
  it('ignores transcripts returned after cancellation', async () => {
    const pending = deferred<{ text: string }>();
    mocks.transcribe.mockReturnValue(pending.promise);
    await act(async () => {
      await controller.start();
    });
    let stopping!: Promise<void>;
    await act(() => {
      stopping = controller.stop();
      return Promise.resolve();
    });
    await act(async () => {
      controller.cancel();
      pending.resolve({ text: 'Do not insert' });
      await stopping;
    });
    expect(command).not.toHaveBeenCalled();
    expect(controller.phase).toBe('idle');
  });
  it('offers the transcript without overwriting edits made while recording', async () => {
    await act(async () => {
      await controller.start();
    });
    field.value = 'Newer user edits';
    await act(async () => {
      await controller.stop();
    });
    expect(field.value).toBe('Newer user edits');
    expect(command).not.toHaveBeenCalled();
    expect(controller.transcript).toBe('Dictated text.');
  });
  it('shows setup guidance before requesting microphone access', async () => {
    mocks.status.mockResolvedValue({ available: false, message: 'Start OpenWhispr' });
    await act(async () => {
      await controller.start();
    });
    expect(controller.error).toBe('Start OpenWhispr');
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it('uses the actually focused field when an editor stops focusin propagation', async () => {
    const other = document.createElement('textarea');
    document.body.append(other);
    other.addEventListener('focusin', (event) => event.stopPropagation());
    await act(() => Promise.resolve(other.focus()));
    expect(controller.target).toBe(other);
    await act(async () => {
      await controller.start();
    });
    other.value = 'Keep this newer edit';
    await act(async () => {
      await controller.stop();
    });
    expect(command).not.toHaveBeenCalled();
    expect(controller.transcript).toBe('Dictated text.');
    expect(other.value).toBe('Keep this newer edit');
  });
  it('automatically stops at the two minute recording limit', async () => {
    vi.useFakeTimers();
    await act(async () => {
      await controller.start();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });
    expect(active.stop).toHaveBeenCalledOnce();
    expect(controller.phase).toBe('idle');
  });
});
