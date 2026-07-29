import { ClaudeBinaryResolver } from '@main/services/team/ClaudeBinaryResolver';
import { killProcessTree, spawnCli } from '@main/utils/childProcess';
import { createLogger } from '@shared/utils/logger';

import type { TeamImportBundleParserPort } from '../../core/application/ports/TeamImportBundleParserPort';

const logger = createLogger('Feature:TeamImport:CliParser');

/**
 * Large sources legitimately stream output for many minutes, so a job is only
 * "hung" when it stops producing data — the inactivity timer resets on every
 * stdout chunk. The max-runtime cap is a backstop against runaway jobs.
 */
const PARSE_INACTIVITY_TIMEOUT_MS = 120_000;
const PARSE_MAX_RUNTIME_MS = 30 * 60_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * The job is structured extraction with a very large output (full workflows,
 * memory files, and skills echoed into JSON). Pin a fast model — the user's
 * default is often an opus-class model whose output speed makes big sources
 * blow through any reasonable time budget.
 */
const PARSE_MODEL_ARGS = ['--model', 'sonnet'];

const STREAM_ARGS = [
  '-p',
  '--output-format',
  'stream-json',
  '--include-partial-messages',
  '--verbose',
  '--max-turns',
  '1',
  '--no-session-persistence',
  ...PARSE_MODEL_ARGS,
];
const LEGACY_JSON_ARGS = [
  '-p',
  '--output-format',
  'json',
  '--max-turns',
  '1',
  '--no-session-persistence',
  ...PARSE_MODEL_ARGS,
];

export interface ParsedStreamJsonLine {
  textDelta?: string;
  result?: string;
}

/**
 * Extracts what the parser cares about from one stream-json stdout line:
 * incremental assistant text (`stream_event`/`content_block_delta`/`text_delta`)
 * and the final `result` envelope's result string.
 */
export function parseStreamJsonLine(line: string): ParsedStreamJsonLine {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const message = parsed as Record<string, unknown>;
  if (message.type === 'stream_event') {
    const event = message.event as Record<string, unknown> | undefined;
    if (event?.type === 'content_block_delta') {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        return { textDelta: delta.text };
      }
    }
    return {};
  }
  if (message.type === 'result' && typeof message.result === 'string' && message.result.trim()) {
    return { result: message.result };
  }
  return {};
}

function looksLikeUnsupportedFlagError(stderr: string): boolean {
  return /unknown (option|argument|flag)|unrecognized (option|argument)/i.test(stderr);
}

/**
 * One-shot extraction job on the stock Claude CLI (the guaranteed runtime for
 * this feature). The prompt travels over stdin because source dumps exceed
 * argv limits on Windows. Output streams as stream-json so callers get live
 * received-character progress; if the installed CLI predates the streaming
 * flags, the run falls back to the plain JSON envelope (no mid-run progress).
 */
export class ClaudeCliBundleParser implements TeamImportBundleParserPort {
  async parse(prompt: string, onProgress?: (receivedChars: number) => void): Promise<string> {
    const binaryPath = await ClaudeBinaryResolver.resolve();
    if (!binaryPath) {
      throw new Error('Claude CLI was not found. Install or sign in to Claude Code first.');
    }

    try {
      return await this.run(binaryPath, STREAM_ARGS, prompt, 'stream', onProgress);
    } catch (error) {
      if (error instanceof UnsupportedFlagsError) {
        logger.warn('Claude CLI lacks stream-json flags; falling back to plain JSON output.');
        return this.run(binaryPath, LEGACY_JSON_ARGS, prompt, 'legacy');
      }
      throw error;
    }
  }

  private run(
    binaryPath: string,
    args: string[],
    prompt: string,
    mode: 'stream' | 'legacy',
    onProgress?: (receivedChars: number) => void
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawnCli(binaryPath, args);

      let totalStdoutBytes = 0;
      let lineRemainder = '';
      let streamedText = '';
      let envelopeResult: string | null = null;
      let legacyStdout = '';
      let stderr = '';
      let settled = false;

      const timeOutWith = (message: string): void => {
        logger.warn(
          `Claude CLI parse job killed (${message}); received ${totalStdoutBytes} stdout bytes`
        );
        finish(new Error(message));
        killProcessTree(child);
      };
      // Legacy JSON mode emits stdout only at the end, so there is no activity
      // signal to watch — it relies on the max-runtime cap alone.
      const armInactivityTimeout = (): ReturnType<typeof setTimeout> | null =>
        mode === 'stream'
          ? setTimeout(() => {
              timeOutWith('The AI parsing job stalled without producing output. Try again.');
            }, PARSE_INACTIVITY_TIMEOUT_MS)
          : null;
      let inactivityTimeout = armInactivityTimeout();
      const touchActivity = (): void => {
        if (settled) return;
        if (inactivityTimeout) clearTimeout(inactivityTimeout);
        inactivityTimeout = armInactivityTimeout();
      };
      const maxRuntimeTimeout = setTimeout(() => {
        timeOutWith('The AI parsing job timed out. Try a smaller source.');
      }, PARSE_MAX_RUNTIME_MS);

      const finish = (error: Error | null, value?: string): void => {
        if (settled) return;
        settled = true;
        if (inactivityTimeout) clearTimeout(inactivityTimeout);
        clearTimeout(maxRuntimeTimeout);
        if (error) reject(error);
        else resolve(value ?? '');
      };

      const consumeStreamChunk = (chunk: string): void => {
        const lines = (lineRemainder + chunk).split('\n');
        lineRemainder = lines.pop() ?? '';
        for (const line of lines) {
          const parsed = parseStreamJsonLine(line);
          if (parsed.textDelta) {
            streamedText += parsed.textDelta;
            onProgress?.(streamedText.length);
          }
          if (parsed.result) envelopeResult = parsed.result;
        }
      };

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        touchActivity();
        totalStdoutBytes += chunk.length;
        if (totalStdoutBytes > MAX_OUTPUT_BYTES) {
          finish(new Error('The AI parser produced too much output.'));
          killProcessTree(child);
          return;
        }
        if (mode === 'stream') consumeStreamChunk(chunk);
        else legacyStdout += chunk;
      });
      child.stderr?.on('data', (chunk: string) => {
        if (stderr.length < 64 * 1024) stderr += chunk;
      });
      child.on('error', (error) => finish(error));
      child.on('close', (code) => {
        if (mode === 'stream') {
          consumeStreamChunk('\n');
          const output = envelopeResult ?? streamedText;
          if (code === 0 && output.trim()) {
            finish(null, output);
            return;
          }
          if (code !== 0 && !output.trim() && looksLikeUnsupportedFlagError(stderr)) {
            finish(new UnsupportedFlagsError());
            return;
          }
        } else if (code === 0 && legacyStdout.trim()) {
          finish(null, unwrapLegacyEnvelope(legacyStdout));
          return;
        }
        // Stream-mode API failures arrive as a result envelope on stdout with
        // an empty stderr — surface whichever channel carried the reason.
        const outputTail = (envelopeResult ?? streamedText ?? legacyStdout).trim().slice(-500);
        const reason =
          stderr.trim().split('\n').pop() ||
          outputTail.split('\n').pop() ||
          `Claude CLI exited with code ${code}.`;
        logger.error(
          `Claude CLI parse job failed (exit ${code}); stderr: ${stderr.slice(0, 2000)}; output tail: ${outputTail}`
        );
        finish(new Error(reason));
      });

      child.stdin?.on('error', () => undefined);
      child.stdin?.write(prompt, () => child.stdin?.end());
    });
  }
}

class UnsupportedFlagsError extends Error {
  constructor() {
    super('Claude CLI does not support stream-json output.');
  }
}

function unwrapLegacyEnvelope(stdout: string): string {
  try {
    const envelope: unknown = JSON.parse(stdout);
    if (envelope && typeof envelope === 'object') {
      const result = (envelope as Record<string, unknown>).result;
      if (typeof result === 'string' && result.trim()) return result;
    }
  } catch {
    // Not an envelope — treat raw stdout as the model output.
  }
  return stdout;
}
