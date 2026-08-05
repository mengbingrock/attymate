import {
  buildStockBootstrapSpawnWorkflowBlocks,
  buildStockClaudeBootstrapPrompt,
  STOCK_BOOTSTRAP_SPAWN_WORKFLOW_MAX_CHARS,
} from '@main/services/team/provisioning/TeamProvisioningBootstrapSpec';
import { describe, expect, it } from 'vitest';

import type { RuntimeBootstrapSpec } from '@main/services/team/provisioning/TeamProvisioningBootstrapSpec';

function baseSpec(members: RuntimeBootstrapSpec['members']): RuntimeBootstrapSpec {
  return {
    version: 1,
    runId: 'run-1',
    mode: 'create',
    initiator: { kind: 'app', source: 'claude_team_stock_runtime' },
    team: { name: 'demo-team', cwd: '/project' },
    lead: { agentLanguage: undefined },
    members,
    launch: { bootstrapTimeoutMs: 60_000, continueOnPartialFailure: true },
    ui: { emitStructuredEvents: true },
  } as unknown as RuntimeBootstrapSpec;
}

describe('buildStockBootstrapSpawnWorkflowBlocks', () => {
  it('emits one verbatim block per member with a workflow', () => {
    const lines = buildStockBootstrapSpawnWorkflowBlocks([
      { name: 'writer', workflow: 'Follow the imported instructions.' },
      { name: 'no-workflow-member' },
    ]);
    const text = lines.join('\n');
    expect(text).toContain('Spawn prompt for writer');
    expect(text).toContain('Follow the imported instructions.');
    expect(text).not.toContain('no-workflow-member');
  });

  it('clamps oversized workflows', () => {
    const lines = buildStockBootstrapSpawnWorkflowBlocks([
      { name: 'writer', workflow: 'x'.repeat(STOCK_BOOTSTRAP_SPAWN_WORKFLOW_MAX_CHARS + 500) },
    ]);
    const block = lines.join('\n');
    expect(block).toContain('[…truncated…]');
    expect(block.length).toBeLessThan(STOCK_BOOTSTRAP_SPAWN_WORKFLOW_MAX_CHARS + 200);
  });

  it('returns nothing when no member has a workflow', () => {
    expect(buildStockBootstrapSpawnWorkflowBlocks([{ name: 'writer' }])).toEqual([]);
  });
});

describe('buildStockClaudeBootstrapPrompt', () => {
  it('includes spawn workflow blocks after the roster', () => {
    const prompt = buildStockClaudeBootstrapPrompt(
      baseSpec([
        { name: 'writer', description: 'writes things', workflow: 'Read your AGENT.md first.' },
      ]),
      ''
    );
    expect(prompt).toContain('- writer: writes things');
    expect(prompt).toContain(
      "Spawn prompt for writer (include this text verbatim at the start of that teammate's spawn prompt)"
    );
    expect(prompt).toContain('Read your AGENT.md first.');
    expect(prompt.indexOf('- writer: writes things')).toBeLessThan(
      prompt.indexOf('Spawn prompt for writer')
    );
  });

  it('keeps the prompt unchanged for members without workflows', () => {
    const prompt = buildStockClaudeBootstrapPrompt(
      baseSpec([{ name: 'writer', description: 'writes things' }]),
      ''
    );
    expect(prompt).not.toContain('Spawn prompt for');
  });
});
