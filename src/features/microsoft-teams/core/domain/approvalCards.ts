import type { TeamsApprovalRecord } from '../../contracts';

export const approvalRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const safeText = (v: unknown): string =>
  String(v ?? '')
    .slice(0, 3000)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/((?:token|password|secret|api_key)\s*[=:]\s*)\S+/gi, '$1[redacted]');

/** Only the official UI transport and low-risk, exact app/origin access are reusable. */
export const taskApprovalGrant = (
  value: TeamsApprovalRecord
): { key: string; resource: string; description: string } | undefined => {
  const p = value.request.params;
  const meta = approvalRecord(p._meta);
  const schema = approvalRecord(p.requestedSchema);
  const originAccess =
    meta.connector_id === 'browser-use' && meta.tool_name === 'access_browser_origin';
  if (
    value.request.method !== 'mcpServer/elicitation/request' ||
    p.serverName !== 'cua_repl' ||
    !['form', 'openai/form'].includes(String(p.mode)) ||
    schema.type !== 'object' ||
    Object.keys(approvalRecord(schema.properties)).length !== 0 ||
    (schema.required !== undefined &&
      (!Array.isArray(schema.required) || schema.required.length !== 0)) ||
    meta.codex_approval_kind !== 'mcp_tool_call' ||
    (meta.codex_request_type !== undefined &&
      !(originAccess && meta.codex_request_type === 'approval_request')) ||
    (meta.codex_sensitive_action === true && !originAccess) ||
    (meta.riskLevel !== undefined && meta.riskLevel !== 'low') ||
    meta.subtitle
  )
    return;
  const tool = approvalRecord(meta.tool_params);
  let resource: string;
  let description: string;
  if (
    meta.connector_id === 'computer-use' &&
    meta.riskLevel === 'low' &&
    Array.isArray(meta.persist) &&
    meta.persist.includes('session') &&
    typeof tool.app === 'string' &&
    tool.app.trim()
  ) {
    resource = `app:${tool.app}`;
    description = `Use this app for this task: ${tool.app}`;
  } else if (
    meta.connector_id === 'browser-use' &&
    meta.tool_name === 'access_browser_origin' &&
    typeof tool.origin === 'string'
  ) {
    try {
      const url = new URL(tool.origin);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.origin !== tool.origin ||
        (meta.origin !== undefined && meta.origin !== tool.origin) ||
        url.username ||
        url.password
      )
        return;
      resource = `origin:${url.origin}`;
      description = `Access ${url.origin} for this task`;
    } catch {
      return;
    }
  } else if (
    meta.connector_id === undefined &&
    p.message === 'Allow the cua_repl MCP server to run tool "js"?' &&
    typeof tool.code === 'string'
  ) {
    resource = 'tool:cua_repl.js';
    description =
      'Use the official Browser/Computer tools for this task. App, website, file and sensitive-action permissions remain separate.';
  } else return;
  return {
    resource,
    description,
    key: JSON.stringify([
      value.target.tenantId,
      value.target.aadObjectId,
      value.target.conversationId,
      value.scope.teamId,
      value.scope.nodeId,
      value.scope.assignmentId,
      value.scope.attemptId,
      value.scope.leaseEpoch,
      value.threadId,
      value.turnId,
      value.appServerGeneration,
      resource,
    ]),
  };
};

export const approvalCard = (value: TeamsApprovalRecord): Record<string, unknown> => {
  const p = value.request.params;
  const taskGrant = taskApprovalGrant(value);
  const names: Record<string, string> = {
    'item/commandExecution/requestApproval': 'Run a local command',
    'item/fileChange/requestApproval': 'Edit local files',
    'item/permissions/requestApproval': 'Access files or the network',
    'tool/requestUserInput': 'Answer your agent',
    'mcpServer/elicitation/request': 'Connect or authorize an app',
  };
  const body: Record<string, unknown>[] = [
    {
      type: 'TextBlock',
      text: 'Your agent needs permission',
      weight: 'Bolder',
      size: 'Medium',
      wrap: true,
    },
    {
      type: 'FactSet',
      facts: [
        { title: 'Computer', value: value.nodeLabel },
        { title: 'Action', value: names[value.request.method] ?? 'Local interaction required' },
      ],
    },
    {
      type: 'TextBlock',
      text: taskGrant
        ? `${taskGrant.description} Approval ends with this task. New resources and sensitive actions still need approval.`
        : 'This request expires after 10 minutes. Allow applies only to this request or turn.',
      wrap: true,
    },
  ];
  for (const [label, item] of Object.entries({
    Reason: p.reason,
    Command: p.command,
    Directory: p.cwd,
    Permissions: p.permissions && JSON.stringify(p.permissions),
    Message: p.message,
  }))
    if (item) body.push({ type: 'TextBlock', text: `${label}: ${safeText(item)}`, wrap: true });
  if (value.request.method === 'mcpServer/elicitation/request') {
    const meta = approvalRecord(p._meta);
    const tool = approvalRecord(meta.tool_params);
    for (const item of [tool.title, tool.code])
      if (typeof item === 'string')
        body.push({ type: 'TextBlock', text: safeText(item), wrap: true });
  }
  if (value.request.method === 'tool/requestUserInput' && Array.isArray(p.questions)) {
    for (const [index, item] of p.questions.entries()) {
      const q = approvalRecord(item);
      body.push({ type: 'TextBlock', text: safeText(q.question), wrap: true });
      if (q.isSecret === true) {
        body.push({
          type: 'TextBlock',
          text: 'Complete secret input on your own computer. Do not enter credentials in Teams.',
          wrap: true,
        });
        continue;
      }
      const choices = Array.isArray(q.options)
        ? q.options.map((o) => ({
            title: safeText(approvalRecord(o).label),
            value: String(approvalRecord(o).label),
          }))
        : [];
      if (choices.length)
        body.push({
          type: 'Input.ChoiceSet',
          id: `answer_${index}`,
          choices,
          isRequired: true,
          errorMessage: 'Select an answer.',
          style: 'expanded',
        });
      else
        body.push({ type: 'Input.Text', id: `answer_${index}`, isRequired: true, maxLength: 2000 });
    }
  }
  let supportedForm = true;
  if (value.request.method === 'mcpServer/elicitation/request' && p.mode !== 'url') {
    for (const [index, [key, raw]] of Object.entries(
      approvalRecord(approvalRecord(p.requestedSchema).properties)
    ).entries()) {
      const field = approvalRecord(raw);
      if (
        !['string', 'number', 'integer', 'boolean'].includes(String(field.type)) ||
        /password|secret|token/i.test(key) ||
        field.format === 'password'
      ) {
        supportedForm = false;
        continue;
      }
      const label = safeText(field.title ?? key);
      body.push({ type: 'TextBlock', text: label, wrap: true });
      if (Array.isArray(field.enum))
        body.push({
          type: 'Input.ChoiceSet',
          id: `form_${index}`,
          choices: field.enum.map((v) => ({ title: safeText(v), value: String(v) })),
          isRequired: true,
          errorMessage: 'Select an answer.',
          style: 'expanded',
        });
      else if (field.type === 'boolean')
        body.push({
          type: 'Input.Toggle',
          id: `form_${index}`,
          title: label,
          valueOn: 'true',
          valueOff: 'false',
          value: 'false',
        });
      else if (field.type === 'number' || field.type === 'integer')
        body.push({ type: 'Input.Number', id: `form_${index}`, isRequired: true });
      else
        body.push({ type: 'Input.Text', id: `form_${index}`, isRequired: true, maxLength: 2000 });
    }
    if (!supportedForm)
      body.push({
        type: 'TextBlock',
        text: 'Complete this form on your own computer. Secret input is not collected in Teams.',
        wrap: true,
      });
  }
  const actions: Record<string, unknown>[] = [];
  const canSubmit =
    supportedForm &&
    (value.request.method !== 'tool/requestUserInput' ||
      (Array.isArray(p.questions) &&
        p.questions.every((q) => approvalRecord(q).isSecret !== true)));
  if (
    value.request.method === 'mcpServer/elicitation/request' &&
    p.mode === 'url' &&
    typeof p.url === 'string' &&
    p.url.startsWith('https://')
  )
    actions.push({ type: 'Action.OpenUrl', title: 'Open authorization page', url: p.url });
  if (canSubmit && names[value.request.method])
    if (taskGrant)
      actions.push({
        type: 'Action.Execute',
        title: 'Allow for this task',
        verb: 'agentApproval',
        data: { action: 'agentApproval', approvalId: value.id, decision: 'accept', forTask: true },
      });
  if (canSubmit && names[value.request.method])
    actions.push({
      type: 'Action.Execute',
      title:
        value.request.method === 'tool/requestUserInput' ||
        (value.request.method === 'mcpServer/elicitation/request' &&
          Object.keys(approvalRecord(approvalRecord(p.requestedSchema).properties)).length > 0)
          ? 'Submit choice'
          : 'Allow once',
      verb: 'agentApproval',
      data: { action: 'agentApproval', approvalId: value.id, decision: 'accept' },
    });
  if (names[value.request.method])
    actions.push({
      type: 'Action.Execute',
      title: 'Decline',
      verb: 'agentApproval',
      associatedInputs: 'none',
      data: { action: 'agentApproval', approvalId: value.id, decision: 'decline' },
    });
  return {
    type: 'AdaptiveCard',
    $schema: 'https://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body,
    actions,
  };
};
