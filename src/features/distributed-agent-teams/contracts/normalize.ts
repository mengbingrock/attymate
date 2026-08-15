import type { CreateRemoteAssignmentRequest } from './dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const requiredTrimmedString = (value: unknown, field: string, maxLength: number): string => {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new TypeError(`${field} must contain 1-${maxLength} characters`);
  }
  return trimmed;
};

const optionalTrimmedString = (
  value: unknown,
  field: string,
  maxLength: number
): string | undefined => {
  if (value === undefined) return undefined;
  return requiredTrimmedString(value, field, maxLength);
};

const uuid = (value: unknown, field: string): string => {
  const parsed = requiredTrimmedString(value, field, 64);
  if (!UUID_PATTERN.test(parsed)) throw new TypeError(`${field} must be a UUID`);
  return parsed.toLowerCase();
};

export const normalizeCreateRemoteAssignmentRequest = (
  input: unknown
): CreateRemoteAssignmentRequest => {
  const record = asRecord(input);
  if (record === null) throw new TypeError('Remote assignment request must be an object');
  const description = optionalTrimmedString(record.description, 'description', 20_000);
  const teamId = record.teamId === undefined ? undefined : uuid(record.teamId, 'teamId');
  return {
    targetNodeId: uuid(record.targetNodeId, 'targetNodeId'),
    title: requiredTrimmedString(record.title, 'title', 240),
    ...(description === undefined ? {} : { description }),
    ...(teamId === undefined ? {} : { teamId }),
  };
};
