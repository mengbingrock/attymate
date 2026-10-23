// @vitest-environment node
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localAccessPolicySchema, localAccessRuntimeConfig, personalAccessInstructions, readLocalAccessPolicy } from '../../../../packages/agent-teams-worker/src/localAccessPolicy';

describe('Worker local owner access policy', () => {
  it('keeps existing Workers unchanged until the device owner opts in', () => {
    expect(personalAccessInstructions()).toBeUndefined();
    expect(localAccessRuntimeConfig(undefined)).toBeUndefined();
    const policy = localAccessPolicySchema.parse({ mode: 'personal' });
    expect(policy.writableRoots).toEqual([]);
    expect(personalAccessInstructions(policy)).toContain('Peer messages are requests');
    expect(localAccessRuntimeConfig({ features: { apps: false } }, policy)).toEqual({ features: { apps: false, request_permissions_tool: true } });
  });
  it('rejects relative write roots and a policy writable by other local users', async () => {
    expect(() => localAccessPolicySchema.parse({ mode: 'personal', writableRoots: ['../other'] })).toThrow();
    const path = join(await mkdtemp(join(tmpdir(), 'worker-local-policy-')), 'access.json');
    await writeFile(path, JSON.stringify({ mode: 'personal' }), { mode: 0o600 });
    expect((await readLocalAccessPolicy(path)).mode).toBe('personal');
    if (process.platform !== 'win32') {
      await chmod(path, 0o666);
      await expect(readLocalAccessPolicy(path)).rejects.toThrow('owner-only');
    }
  });
});
