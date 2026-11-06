import { DICTATION_MAX_SECONDS, DICTATION_SAMPLE_RATE } from '../../contracts';
import { encodeDictationWav } from '../../core/domain/wav';

export interface DictationRecording {
  stop(): Promise<ArrayBuffer>;
  cancel(): void;
}

export async function startDictationRecording(): Promise<DictationRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  const release = (): void => {
    stream.getTracks().forEach((track) => track.stop());
  };
  try {
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    let error: Error | null = null;
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = () => {
      error = new Error('Microphone recording failed. Please try again.');
      release();
    };
    recorder.start(250);
    return {
      cancel: () => {
        recorder.ondataavailable = null;
        if (recorder.state !== 'inactive') recorder.stop();
        release();
        chunks.length = 0;
      },
      stop: async () => {
        if (error) throw error;
        if (recorder.state === 'inactive')
          throw new Error('Microphone recording ended unexpectedly. Please try again.');
        await new Promise<void>((resolve, reject) => {
          recorder.onstop = () => {
            release();
            resolve();
          };
          recorder.onerror = () => {
            release();
            reject(new Error('Microphone recording failed. Please try again.'));
          };
          recorder.stop();
        });
        const context = new AudioContext();
        try {
          const decoded = await context.decodeAudioData(
            await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer()
          );
          if (decoded.duration > DICTATION_MAX_SECONDS + 2)
            throw new Error('Recording exceeded two minutes. Please record a shorter message.');
          const frames = Math.min(
            Math.ceil(decoded.duration * DICTATION_SAMPLE_RATE),
            DICTATION_MAX_SECONDS * DICTATION_SAMPLE_RATE
          );
          const offline = new OfflineAudioContext(1, Math.max(1, frames), DICTATION_SAMPLE_RATE);
          const source = offline.createBufferSource();
          source.buffer = decoded;
          source.connect(offline.destination);
          source.start();
          const audio = (await offline.startRendering()).getChannelData(0);
          if (!audio.some((sample) => Math.abs(sample) > 0.001))
            throw new Error('No speech detected. Check your microphone and try again.');
          return encodeDictationWav(audio);
        } finally {
          await context.close();
          chunks.length = 0;
        }
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}
