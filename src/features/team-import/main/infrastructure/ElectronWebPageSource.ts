import { net } from 'electron';

import type { TeamImportWebSourcePort } from '../../core/application/ports/TeamImportRawSourcePort';
import type { TeamImportRawSourceDump } from '../../core/domain/teamImportLlmPrompt';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_DUMP_BYTES = 300 * 1024;

/** Cheap HTML→text reduction; the LLM handles residual markup. */
export function stripHtmlToText(html: string): string {
  const withoutBlocks = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const withBreaks = withoutBlocks
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|pre|blockquote)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n');
  const text = withBreaks
    .replace(/<[^>]{1,500}>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export class ElectronWebPageSource implements TeamImportWebSourcePort {
  async fetchPage(url: string): Promise<TeamImportRawSourceDump> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await net.fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'text/html,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.5' },
      });
    } catch (error) {
      throw new Error(
        controller.signal.aborted
          ? 'Fetching the page timed out.'
          : `Could not fetch the page: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new Error(`The page returned HTTP ${response.status}.`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !/text\/|json|xml|markdown/i.test(contentType)) {
      throw new Error(`The page is not a text document (${contentType.split(';')[0]}).`);
    }

    const raw = await response.text();
    const bounded = raw.slice(0, MAX_RESPONSE_BYTES);
    const isHtml = /html/i.test(contentType) || /^\s*(<!doctype|<html)/i.test(bounded);
    let content = isHtml ? stripHtmlToText(bounded) : bounded;
    if (!content.trim()) content = bounded;

    let truncated = raw.length > bounded.length;
    if (Buffer.byteLength(content, 'utf8') > MAX_DUMP_BYTES) {
      content = Buffer.from(content, 'utf8').subarray(0, MAX_DUMP_BYTES).toString('utf8');
      truncated = true;
    }

    return {
      label: `webpage ${new URL(url).host}`,
      files: [{ path: url, content }],
      truncated,
    };
  }
}
