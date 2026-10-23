import type {
  TeamsBinding,
  TeamsRequest,
  TeamsRequestJournal,
  TeamsResponse,
  TeamsRuntimePort,
} from '../../contracts';

export class TeamsGateway {
  private readonly busyNodes = new Set<string>();

  constructor(
    private readonly bindings: readonly TeamsBinding[],
    private readonly runtime: TeamsRuntimePort,
    private readonly journal: TeamsRequestJournal
  ) {
    const identities = bindings.map((binding) => `${binding.tenantId}:${binding.aadObjectId}`);
    if (new Set(identities).size !== identities.length) {
      throw new Error('Each Microsoft identity must have exactly one pilot binding');
    }
  }

  authorize(request: TeamsRequest): TeamsBinding {
    if (request.channelId !== 'msteams' || request.conversationType !== 'personal') {
      throw new Error('This pilot supports private Teams conversations only');
    }
    const binding = this.bindings.find(
      (candidate) =>
        candidate.tenantId === request.tenantId &&
        candidate.aadObjectId === request.aadObjectId &&
        request.aadObjectId.length > 0
    );
    if (binding === undefined) throw new Error('This Microsoft identity is not enrolled');
    if (!request.requestKey || request.requestKey.length > 256)
      throw new Error('Invalid request identity');
    if (!request.text.trim() || request.text.length > 20_000)
      throw new Error('Send a message of 1-20000 characters');
    return binding;
  }

  async handle(request: TeamsRequest): Promise<string> {
    return (await this.handleResponse(request)).text;
  }

  async handleResponse(request: TeamsRequest): Promise<TeamsResponse> {
    const binding = this.authorize(request);
    const previous = this.journal.begin(request.requestKey);
    if (!previous.fresh)
      return {
        text:
          previous.reply ??
          'This request was already received. Use status to check your agent; it has not been submitted again.',
        deliveryKey: previous.deliveryKey ?? `request:${request.requestKey}`,
      };
    const text = request.text.trim();
    if (/^\/?help$/i.test(text)) {
      const reply =
        'Send status to check your worker, or send a message to your existing agent. Your agent can use the connections enabled for this worker.';
      this.journal.finish(request.requestKey, reply);
      return { text: reply, deliveryKey: `request:${request.requestKey}` };
    }
    if (/^\/?status$/i.test(text)) {
      const reply = await this.runtime.status(binding);
      this.journal.finish(request.requestKey, reply);
      return { text: reply, deliveryKey: `request:${request.requestKey}` };
    }
    if (this.busyNodes.has(binding.nodeId)) {
      const reply =
        'Your agent is handling a Teams request. Please wait for its reply before sending another request.';
      this.journal.finish(request.requestKey, reply);
      return { text: reply, deliveryKey: `request:${request.requestKey}` };
    }
    this.busyNodes.add(binding.nodeId);
    try {
      const response = this.runtime.exchangeResponse
        ? await this.runtime.exchangeResponse(binding, text)
        : { text: await this.runtime.exchange(binding, text) };
      const deliveryKey = response.deliveryKey ?? `request:${request.requestKey}`;
      this.journal.finish(request.requestKey, response.text, deliveryKey);
      return { ...response, deliveryKey };
    } catch {
      const reply =
        'The request could not be confirmed complete. It will not be submitted automatically again. Check status and the pilot diagnostics before retrying.';
      this.journal.finish(request.requestKey, reply);
      return { text: reply, deliveryKey: `request:${request.requestKey}` };
    } finally {
      this.busyNodes.delete(binding.nodeId);
    }
  }
}
