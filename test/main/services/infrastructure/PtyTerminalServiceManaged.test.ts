// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn(), buildEnv: vi.fn() }));
vi.mock('@main/utils/safeWebContentsSend', () => ({ safeSendToRenderer: mocks.send }));
vi.mock('@main/services/runtime/providerAwareCliEnv', () => ({
  buildProviderAwareCliEnv: mocks.buildEnv,
}));

import { managedTerminalRegistry } from '@main/services/infrastructure/ManagedTerminalRegistry';
import { PtyTerminalService } from '@main/services/infrastructure/PtyTerminalService';

afterEach(() => {
  managedTerminalRegistry.killAll();
  vi.clearAllMocks();
});

describe('app-owned terminal views', () => {
  it('attaches and detaches a console without starting or killing the agent', async () => {
    const offData = vi.fn();
    const offExit = vi.fn();
    const terminal = {
      write: vi.fn(),
      resize: vi.fn(),
      snapshot: vi.fn().mockResolvedValue('current screen'),
      onData: vi.fn().mockReturnValue(offData),
      onExit: vi.fn().mockReturnValue(offExit),
      kill: vi.fn(),
    };
    managedTerminalRegistry.register('owned', terminal);
    const service = new PtyTerminalService();
    const view = await service.spawn({ managedSessionId: 'owned' });
    service.write(view, 'hello');
    expect(terminal.write).toHaveBeenCalledWith('hello');
    service.resize(view, 100, 30);
    await Promise.resolve();
    expect(terminal.resize).toHaveBeenCalledWith(100, 30);
    expect(mocks.send).toHaveBeenCalledWith(null, expect.any(String), view, 'current screen');
    service.kill(view);
    expect(offData).toHaveBeenCalledOnce();
    expect(offExit).toHaveBeenCalledOnce();
    expect(terminal.kill).not.toHaveBeenCalled();
    expect(mocks.buildEnv).not.toHaveBeenCalled();
    expect(managedTerminalRegistry.get('owned')).toBe(terminal);
    service.killAll();
    expect(terminal.kill).toHaveBeenCalledOnce();
  });

  it('rejects a console request for an exited agent', async () => {
    await expect(new PtyTerminalService().spawn({ managedSessionId: 'gone' })).rejects.toThrow(
      'exited'
    );
    expect(mocks.buildEnv).not.toHaveBeenCalled();
  });
});
