import { useCallback, useEffect, useRef, useState } from 'react';

import { api, isElectronMode } from '@renderer/api';

import { DICTATION_MAX_SECONDS } from '../../contracts';
import { startDictationRecording } from '../adapters/recording';
import { captureTextDestination, getDictationTarget } from '../adapters/textTarget';

import type { DictationRecording } from '../adapters/recording';

type Phase = 'idle' | 'starting' | 'recording' | 'transcribing';

interface DictationController {
  enabled: boolean;
  target: HTMLElement | null;
  phase: Phase;
  seconds: number;
  position: { left: number; top: number };
  error: string;
  transcript: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => void;
}

export function useDictation(): DictationController {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const recording = useRef<DictationRecording | null>(null);
  const destination = useRef<ReturnType<typeof captureTextDestination> | null>(null);
  const generation = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const stopRef = useRef<() => void>(() => undefined);
  const enabled = isElectronMode() && Boolean(api.dictation);
  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const cancel = useCallback(() => {
    generation.current += 1;
    recording.current?.cancel();
    recording.current = null;
    changePhase('idle');
    setError('');
    setTranscript('');
    setTarget(null);
  }, [changePhase]);

  useEffect(() => {
    if (!enabled) return;
    const focus = (event: FocusEvent): void => {
      if (event.target === window) return;
      if (event.target instanceof Element && event.target.closest('[data-dictation-toolbar]'))
        return;
      if (phaseRef.current !== 'idle') return;
      setTarget(getDictationTarget(event.target));
      setError('');
      setTranscript('');
    };
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && phaseRef.current !== 'idle') {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
      }
    };
    window.addEventListener('focus', focus, true);
    document.addEventListener('keydown', keydown, true);
    setTarget(getDictationTarget(document.activeElement));
    return () => {
      window.removeEventListener('focus', focus, true);
      document.removeEventListener('keydown', keydown, true);
    };
  }, [cancel, enabled]);

  useEffect(() => {
    if (!target) return;
    const update = (): void => {
      if (!target.isConnected) {
        if (phaseRef.current === 'idle')
          setTarget((current) => (current === target ? null : current));
        return;
      }
      const rect = target.getBoundingClientRect();
      const expanded = phase !== 'idle' || Boolean(error || transcript);
      const width = Math.min(expanded ? 350 : 144, window.innerWidth - 24);
      setPosition({
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - (expanded ? 300 : 64))),
      });
    };
    update();
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    document.addEventListener('animationend', update, true);
    const observer = new ResizeObserver(update);
    observer.observe(target);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
      document.removeEventListener('animationend', update, true);
    };
  }, [target, phase, error, transcript]);

  useEffect(
    () => () => {
      generation.current += 1;
      recording.current?.cancel();
    },
    []
  );

  const stop = useCallback(async () => {
    if (phaseRef.current !== 'recording' || !recording.current) return;
    const active = recording.current;
    recording.current = null;
    const id = generation.current;
    changePhase('transcribing');
    try {
      const audio = await active.stop();
      if (generation.current !== id) return;
      const result = await api.dictation!.transcribe(audio);
      if (generation.current !== id) return;
      if (!result.text) throw new Error('No speech detected. Please try again.');
      if (!destination.current?.insert(result.text)) {
        setTranscript(result.text);
        setError(
          'The field changed while transcribing. Copy your transcript below to keep your edits.'
        );
      }
    } catch (failure) {
      if (generation.current === id)
        setError(
          failure instanceof Error ? failure.message : 'Dictation failed. Please try again.'
        );
    } finally {
      active.cancel();
      if (generation.current === id) changePhase('idle');
    }
  }, [changePhase]);
  stopRef.current = () => {
    void stop();
  };

  useEffect(() => {
    if (phase !== 'recording') return;
    const began = Date.now();
    setSeconds(0);
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - began) / 1000);
      setSeconds(elapsed);
      if (elapsed >= DICTATION_MAX_SECONDS) stopRef.current();
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  const start = useCallback(async () => {
    if (!target || phaseRef.current !== 'idle' || !api.dictation) return;
    // Focus can move before React commits its focus-tracking update (or an
    // editor can stop focusin propagation). Read the actual field at the click.
    const currentTarget = getDictationTarget(document.activeElement) ?? target;
    destination.current = captureTextDestination(currentTarget);
    setTarget(currentTarget);
    const id = ++generation.current;
    changePhase('starting');
    setError('');
    setTranscript('');
    try {
      const status = await api.dictation.getStatus();
      if (generation.current !== id) return;
      if (!status.available) throw new Error(status.message || 'OpenWhispr is unavailable.');
      const active = await startDictationRecording();
      if (generation.current !== id) {
        active.cancel();
        return;
      }
      recording.current = active;
      changePhase('recording');
    } catch (failure) {
      if (generation.current !== id) return;
      const message =
        failure instanceof DOMException && failure.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow microphone access for AttyMate in your system settings.'
          : failure instanceof Error
            ? failure.message
            : 'Could not start dictation.';
      setError(message);
      changePhase('idle');
    }
  }, [target, changePhase]);

  return { enabled, target, phase, seconds, position, error, transcript, start, stop, cancel };
}
