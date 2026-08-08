import { resolveTeamProjectPath } from '@main/services/team/resolveTeamProjectPath';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@shared/utils/logger', () => {
  const warn = vi.fn();
  return {
    createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn, debug: vi.fn() }),
    __warn: warn,
  };
});

function deps(overrides: {
  live?: string | null;
  saved?: string | null;
  config?: string | null;
}) {
  return {
    getLiveCwd: vi.fn(() => overrides.live ?? null),
    getSavedCwd: vi.fn(() => Promise.resolve(overrides.saved ?? null)),
    getConfigProjectPath: vi.fn(() => Promise.resolve(overrides.config ?? null)),
  };
}

describe('resolveTeamProjectPath', () => {
  it('prefers the live session cwd over every persisted path', async () => {
    // The mismatch this resolver exists to kill: config said CaseNO.000000
    // while the lead's session actually ran in CaseNO.1234567 — the scan
    // must target where the agents really are.
    const d = deps({
      live: '/cases/CaseNO.1234567',
      saved: '/cases/CaseNO.000000',
      config: '/cases/CaseNO.000000',
    });
    expect(await resolveTeamProjectPath('team', d)).toBe('/cases/CaseNO.1234567');
    // No need to consult config when a stronger source answered.
    expect(d.getConfigProjectPath).not.toHaveBeenCalled();
  });

  it('uses the saved launch cwd for a stopped team', async () => {
    const d = deps({ live: null, saved: '/cases/next-launch', config: '/cases/old-config' });
    expect(await resolveTeamProjectPath('team', d)).toBe('/cases/next-launch');
  });

  it('falls back to config-derived paths last', async () => {
    const d = deps({ live: null, saved: null, config: '/cases/from-config' });
    expect(await resolveTeamProjectPath('team', d)).toBe('/cases/from-config');
  });

  it('returns null when nothing knows the path', async () => {
    expect(await resolveTeamProjectPath('team', deps({}))).toBeNull();
  });

  it('survives throwing sources', async () => {
    const d = {
      getLiveCwd: vi.fn(() => null),
      getSavedCwd: vi.fn(() => Promise.reject(new Error('meta unreadable'))),
      getConfigProjectPath: vi.fn(() => Promise.resolve('/cases/from-config')),
    };
    expect(await resolveTeamProjectPath('team', d)).toBe('/cases/from-config');
  });

  it('treats blank strings as absent', async () => {
    const d = deps({ live: '  ', saved: '', config: '/cases/real' });
    expect(await resolveTeamProjectPath('team', d)).toBe('/cases/real');
  });
});
