/** Loopback-only deterministic Responses fixture that exercises native MCP calls. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';

interface ModelInput {
  role?: string;
  type?: string;
  name?: string;
  call_id?: string;
  output?: unknown;
  content?: unknown;
}
interface ModelTool {
  type?: string;
  name?: string;
  tools?: ModelTool[];
}
export interface FixtureRequest {
  model: string;
  input?: ModelInput[];
  tools?: ModelTool[];
}

const modelTool = (tools: ModelTool[], name: string) => {
  for (const tool of tools) {
    if (tool.type === 'namespace' && tool.tools?.some((entry) => entry.name === name))
      return { name, namespace: tool.name };
    if (tool.type === 'function' && (tool.name === name || tool.name?.endsWith('__' + name)))
      return { name: tool.name };
  }
  throw new Error('Native model request did not expose MCP ' + name);
};

const assertToolSucceeded = (output: unknown): void => {
  if (typeof output === 'string') {
    assert.ok(!output.includes('execution failed:'), 'Native model MCP tool execution failed');
    try {
      assertToolSucceeded(JSON.parse(output));
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
    return;
  }
  if (Array.isArray(output)) {
    output.forEach(assertToolSucceeded);
    return;
  }
  if (output && typeof output === 'object') {
    assert.notEqual(
      (output as { isError?: unknown }).isError,
      true,
      'Native model MCP call returned an error'
    );
    Object.values(output).forEach(assertToolSucceeded);
  }
};

const nextModelItem = (
  request: FixtureRequest,
  toolCalls: { name: string; namespace?: string }[]
) => {
  const input = request.input ?? [];
  const wakeIndex = input.findLastIndex((item) => item.role === 'user');
  const wake = JSON.stringify(input[wakeIndex]);
  if (wake?.includes('NATIVE_TASK_FLOW')) {
    const steps = [
      { name: 'runtime_context', arguments: {} },
      { name: 'progress_report', arguments: { summary: 'NATIVE_TASK_PROGRESS', percent: 100 } },
      { name: 'review_request', arguments: { summary: 'NATIVE_TASK_REVIEW', recipient: 'lead' } },
      {
        name: 'result_submit',
        arguments: {
          outcome: 'completed',
          summary: 'NATIVE_TASK_RESULT',
          tests: ['local fixture'],
        },
      },
    ];
    const current = input.slice(wakeIndex + 1);
    for (const step of steps) {
      const call = current.find(
        (item) =>
          item.type === 'function_call' && item.call_id?.startsWith('native_task_' + step.name)
      );
      const result =
        call &&
        current.find(
          (item) => item.type === 'function_call_output' && item.call_id === call.call_id
        );
      if (result) {
        assertToolSucceeded(result.output);
        continue;
      }
      const selected = modelTool(request.tools ?? [], step.name);
      toolCalls.push({
        name: selected.name!,
        ...('namespace' in selected ? { namespace: selected.namespace } : {}),
      });
      return {
        type: 'function_call',
        call_id: 'native_task_' + step.name + '_' + randomUUID(),
        ...selected,
        arguments: JSON.stringify(step.arguments),
      };
    }
  }
  if (wake?.includes('Agent Teams inbox notification.')) {
    const current = input.slice(wakeIndex + 1);
    const listCall = current.find(
      (item) =>
        item.type === 'function_call' && item.call_id?.startsWith('native_smoke_message_list_')
    );
    const listResult =
      listCall &&
      current.find(
        (item) => item.type === 'function_call_output' && item.call_id === listCall.call_id
      );
    const name = listResult ? 'message_ack' : 'message_list';
    const ackCall = current.find(
      (item) =>
        item.type === 'function_call' && item.call_id?.startsWith('native_smoke_message_ack_')
    );
    const ackResult =
      ackCall &&
      current.find(
        (item) => item.type === 'function_call_output' && item.call_id === ackCall.call_id
      );
    if (listResult) {
      assertToolSucceeded(listResult.output);
      assert.ok(
        JSON.stringify(listResult.output).includes('messages'),
        'Native model did not receive the MCP inbox'
      );
    }
    if (ackResult) {
      assertToolSucceeded(ackResult.output);
      assert.ok(
        JSON.stringify(ackResult.output).includes('processedAt'),
        'Native model MCP receipt was not processed'
      );
    } else {
      const selected = modelTool(request.tools ?? [], name);
      toolCalls.push({
        name: selected.name!,
        ...('namespace' in selected ? { namespace: selected.namespace } : {}),
      });
      const messageId = wake.match(
        /Message IDs: ([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i
      )?.[1];
      assert.ok(messageId, 'Inbox wake notification omitted its message ID');
      return {
        type: 'function_call',
        call_id: 'native_smoke_' + name + '_' + randomUUID(),
        ...selected,
        arguments: JSON.stringify(name === 'message_ack' ? { messageId } : {}),
      };
    }
  }
  return {
    id: 'msg_' + randomUUID(),
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: 'NATIVE_TEAM_WAKE_OK' }],
  };
};

export const startResponsesFixture = async () => {
  const requests: { model: string; body: FixtureRequest }[] = [];
  const toolCalls: { name: string; namespace?: string }[] = [];
  const held = new Set<() => void>();
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || !request.url?.endsWith('/responses')) {
        response.writeHead(404);
        response.end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      let body = Buffer.concat(chunks);
      if (request.headers['content-encoding'] === 'gzip') body = gunzipSync(body);
      if (request.headers['content-encoding'] === 'zstd') body = zstdDecompressSync(body);
      const parsed = JSON.parse(body.toString()) as FixtureRequest;
      requests.push({ model: parsed.model, body: parsed });
      if (
        JSON.stringify(parsed.input?.filter((item) => item.role === 'user').at(-1))?.includes(
          'NATIVE_TASK_HOLD'
        )
      ) {
        await new Promise<void>((resolve) => held.add(resolve));
      }
      const id = 'resp_' + randomUUID();
      const events = [
        { type: 'response.created', response: { id } },
        {
          type: 'response.output_item.done',
          item: nextModelItem(parsed, toolCalls),
        },
        {
          type: 'response.completed',
          response: { id, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
        },
      ];
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      response.end(
        events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
      );
    } catch (error) {
      response.writeHead(500);
      response.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    toolCalls,
    get heldCount() {
      return held.size;
    },
    releaseHeld: () => {
      for (const release of held) release();
      held.clear();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const release of held) release();
        held.clear();
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};
