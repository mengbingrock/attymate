import {
  buildCodexExecModelProbeArgs,
  buildProviderPreflightPingArgs,
  getProviderPreflightModel,
} from '@main/services/runtime/providerModelProbe';
import { describe, expect, it } from 'vitest';

describe('providerModelProbe', () => {
  it('uses the configured model override for Codex preflight probes', () => {
    expect(getProviderPreflightModel('codex', { modelOverride: 'gateway-codex-model' })).toBe(
      'gateway-codex-model'
    );

    expect(
      buildProviderPreflightPingArgs('codex', { modelOverride: 'gateway-codex-model' })
    ).toContain('gateway-codex-model');
  });

  it('keeps the default Codex preflight model when no override is configured', () => {
    expect(getProviderPreflightModel('codex')).toBe('gpt-5.6-sol');
    expect(buildProviderPreflightPingArgs('codex')).toContain('gpt-5.6-sol');
  });

  it('builds direct Codex exec probes using the selected model and existing configuration', () => {
    expect(buildCodexExecModelProbeArgs('gpt-5.4')).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--ephemeral',
      '--model',
      'gpt-5.4',
      'Output only the single word PONG.',
    ]);
  });

  it('inherits the configured Codex model when none is explicitly selected', () => {
    const args = buildCodexExecModelProbeArgs();
    expect(args).not.toContain('--model');
    expect(args).not.toContain('--ignore-user-config');
    expect(args).toContain('--ephemeral');
  });
});
