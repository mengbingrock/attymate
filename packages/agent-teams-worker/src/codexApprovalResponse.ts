import type { CodexAppServerRequest } from './codexAppServerClient';

export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';
type FormValue = string | number | boolean;
const record = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const questionAnswer = (value: unknown, allow: boolean, answers?: Record<string, string[]>) => {
  const q = record(value);
  if (typeof q.id !== 'string' || (allow && q.isSecret === true))
    throw new Error('This input needs the local owner interface');
  const options = Array.isArray(q.options)
    ? q.options.map((o) => record(o).label).filter((s): s is string => typeof s === 'string')
    : [];
  const selected = allow ? answers?.[q.id] : [];
  if (
    allow &&
    (!selected?.length ||
      (options.length > 0 && selected.some((s) => !options.includes(s) && q.isOther !== true)))
  )
    throw new Error('Select an answer from this approval card');
  return [q.id, { answers: selected ?? [] }] as const;
};

const validFieldValue = (field: Record<string, unknown>, value: FormValue): boolean => {
  if (
    field.type === 'integer'
      ? typeof value !== 'number' || !Number.isInteger(value)
      : typeof value !== field.type
  )
    return false;
  if (Array.isArray(field.enum) && !field.enum.includes(value)) return false;
  if (typeof value === 'string')
    return (
      !(typeof field.minLength === 'number' && value.length < field.minLength) &&
      !(typeof field.maxLength === 'number' && value.length > field.maxLength)
    );
  if (typeof value === 'number')
    return (
      Number.isFinite(value) &&
      !(typeof field.minimum === 'number' && value < field.minimum) &&
      !(typeof field.maximum === 'number' && value > field.maximum)
    );
  return true;
};

const elicitationResponse = (
  params: Record<string, unknown>,
  form?: Record<string, string | number | boolean>
) => {
  if (params.mode === 'url') return { action: 'accept', content: null };
  const schema = record(params.requestedSchema);
  const properties = record(schema.properties);
  if (
    Object.entries(properties).some(
      ([key, value]) =>
        !['string', 'number', 'integer', 'boolean'].includes(String(record(value).type)) ||
        /password|secret|token/i.test(key) ||
        record(value).format === 'password'
    )
  )
    throw new Error('This form needs the local owner interface');
  const content = form ?? {};
  if (Object.keys(content).some((k) => !Object.hasOwn(properties, k)))
    throw new Error('Unexpected approval form field');
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (required.some((key) => typeof key === 'string' && !Object.hasOwn(content, key)))
    throw new Error('Complete the required approval form fields');
  if (
    Object.entries(content).some(([key, value]) => !validFieldValue(record(properties[key]), value))
  )
    throw new Error('Invalid approval form field');
  return { action: 'accept', content };
};

const permissionResponse = (params: Record<string, unknown>, allow: boolean) => {
  const requested = record(params.permissions);
  return {
    permissions: allow
      ? Object.fromEntries(
          ['fileSystem', 'network']
            .filter((key) => requested[key] !== undefined)
            .map((key) => [key, requested[key]])
        )
      : {},
    scope: 'turn',
  };
};

/** The owner chooses a decision; requested permissions always come from the pending RPC. */
export const codexApprovalResponse = (
  request: CodexAppServerRequest,
  decision: ApprovalDecision,
  answers?: Record<string, string[]>,
  form?: Record<string, string | number | boolean>
): unknown => {
  const allow = decision === 'accept' || decision === 'acceptForSession';
  const params = record(request.params);
  switch (request.method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { decision };
    case 'item/permissions/requestApproval':
      return permissionResponse(params, allow);
    case 'tool/requestUserInput':
      if (!Array.isArray(params.questions) || params.questions.length > 3)
        throw new Error('Unsupported approval questions');
      return {
        answers: Object.fromEntries(params.questions.map((q) => questionAnswer(q, allow, answers))),
      };
    case 'mcpServer/elicitation/request':
      return allow
        ? elicitationResponse(params, form)
        : { action: decision === 'cancel' ? 'cancel' : 'decline', content: null };
    default:
      throw new Error('Unsupported Codex approval request');
  }
};
