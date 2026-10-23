// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { codexApprovalResponse } from '../../../../packages/agent-teams-worker/src/codexApprovalResponse';

describe('Owner approval responses', () => {
  it('grants only requested permissions for this turn and returns no grants on decline', () => {
    const request = {
      id: 4,
      method: 'item/permissions/requestApproval',
      params: { permissions: { fileSystem: { read: ['/test/downloads'] }, unrelated: 'ignored' } },
    };
    expect(codexApprovalResponse(request, 'acceptForSession')).toEqual({
      permissions: { fileSystem: { read: ['/test/downloads'] } },
      scope: 'turn',
    });
    expect(codexApprovalResponse(request, 'decline')).toEqual({ permissions: {}, scope: 'turn' });
  });
  it('rejects answers outside the pending choices and secret input', () => {
    const request = {
      id: 1,
      method: 'tool/requestUserInput',
      params: { questions: [{ id: 'a', options: [{ label: 'Allow' }, { label: 'Decline' }] }] },
    };
    expect(() => codexApprovalResponse(request, 'accept', { a: ['made up'] })).toThrow(
      'Select an answer'
    );
    expect(codexApprovalResponse(request, 'accept', { a: ['Allow'] })).toEqual({
      answers: { a: { answers: ['Allow'] } },
    });
    expect(() =>
      codexApprovalResponse(
        { ...request, params: { questions: [{ id: 'password', isSecret: true }] } },
        'accept'
      )
    ).toThrow('local owner');
  });
  it('does not turn an unsupported form into a blanket approval', () => {
    const request = {
      id: 2,
      method: 'mcpServer/elicitation/request',
      params: { mode: 'form', requestedSchema: { properties: { password: { type: 'string' } } } },
    };
    expect(() => codexApprovalResponse(request, 'accept')).toThrow('local owner');
    expect(codexApprovalResponse(request, 'decline')).toEqual({ action: 'decline', content: null });
  });
  it('handles the official tool consent and validates form fields against the pending schema', () => {
    const request = {
      id: 3,
      method: 'mcpServer/elicitation/request',
      params: {
        mode: 'form',
        requestedSchema: { type: 'object', properties: {} },
      },
    };
    expect(codexApprovalResponse(request, 'accept')).toEqual({ action: 'accept', content: {} });
    const choices = {
      ...request,
      params: {
        mode: 'form',
        requestedSchema: {
          properties: {
            choice: { type: 'string', enum: ['Once', 'No'] },
            amount: { type: 'integer', minimum: 1 },
          },
          required: ['choice'],
        },
      },
    };
    expect(
      codexApprovalResponse(choices, 'accept', undefined, { choice: 'Once', amount: 2 })
    ).toEqual({ action: 'accept', content: { choice: 'Once', amount: 2 } });
    expect(() => codexApprovalResponse(choices, 'accept', undefined, { choice: 'Always' })).toThrow(
      'Invalid approval'
    );
    expect(() => codexApprovalResponse(choices, 'accept', undefined, { amount: 2 })).toThrow(
      'required'
    );
    expect(() =>
      codexApprovalResponse(choices, 'accept', undefined, { choice: 'Once', extra: true })
    ).toThrow('Unexpected');
  });
});
