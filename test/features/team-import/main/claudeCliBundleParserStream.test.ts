import { parseStreamJsonLine } from '@features/team-import/main/infrastructure/ClaudeCliBundleParser';
import { describe, expect, it } from 'vitest';

describe('parseStreamJsonLine', () => {
  it('extracts assistant text deltas', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"sch' } },
    });
    expect(parseStreamJsonLine(line)).toEqual({ textDelta: '{"sch' });
  });

  it('ignores non-text deltas and other stream events', () => {
    const signature = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'signature_delta', signature: 'x' } },
    });
    expect(parseStreamJsonLine(signature)).toEqual({});
    expect(parseStreamJsonLine(JSON.stringify({ type: 'system', subtype: 'init' }))).toEqual({});
    expect(
      parseStreamJsonLine(JSON.stringify({ type: 'stream_event', event: { type: 'message_stop' } }))
    ).toEqual({});
  });

  it('extracts the final result envelope', () => {
    const line = JSON.stringify({ type: 'result', is_error: false, result: '{"schema":"x"}' });
    expect(parseStreamJsonLine(line)).toEqual({ result: '{"schema":"x"}' });
  });

  it('tolerates malformed and non-JSON lines', () => {
    expect(parseStreamJsonLine('')).toEqual({});
    expect(parseStreamJsonLine('not json')).toEqual({});
    expect(parseStreamJsonLine('{"broken')).toEqual({});
    expect(parseStreamJsonLine(JSON.stringify({ type: 'result', result: '   ' }))).toEqual({});
  });
});
