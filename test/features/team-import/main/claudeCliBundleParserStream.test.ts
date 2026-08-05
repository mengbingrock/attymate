import {
  describeParseFailure,
  parseStreamJsonLine,
} from '@features/team-import/main/infrastructure/ClaudeCliBundleParser';
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
    const line = JSON.stringify({
      type: 'result',
      is_error: false,
      subtype: 'success',
      result: '{"schema":"x"}',
    });
    expect(parseStreamJsonLine(line)).toEqual({ result: '{"schema":"x"}', subtype: 'success' });
  });

  it('keeps the subtype of a failed envelope that carries no result text', () => {
    // How a tool-using run reports itself: no text anywhere, so the subtype is
    // the only evidence of what went wrong.
    const line = JSON.stringify({ type: 'result', is_error: true, subtype: 'error_max_turns' });
    expect(parseStreamJsonLine(line)).toEqual({ subtype: 'error_max_turns' });
  });

  it('tolerates malformed and non-JSON lines', () => {
    expect(parseStreamJsonLine('')).toEqual({});
    expect(parseStreamJsonLine('not json')).toEqual({});
    expect(parseStreamJsonLine('{"broken')).toEqual({});
    expect(parseStreamJsonLine(JSON.stringify({ type: 'result', result: '   ' }))).toEqual({});
  });
});

describe('describeParseFailure', () => {
  it('explains a turn spent on a tool call rather than an answer', () => {
    expect(describeParseFailure('error_max_turns', 1)).toContain('tried to use a tool');
  });

  it('falls back to the exit code when the envelope says nothing', () => {
    expect(describeParseFailure(null, 143)).toBe('Claude CLI exited with code 143.');
  });
});
