import { spawn, execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

/** Target the paired profile, not an unrelated personal desktop instance. */
export const openDesktopChat = async (launcher: string, threadId: string) => {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(threadId)) throw new Error('Invalid thread identity');
  const root = dirname(dirname(launcher));
  let pid: number | undefined;
  try {
    pid = Number(await readFile(join(root, 'desktop-data/team-desktop.pid'), 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 1) pid = undefined;
    else {
      process.kill(pid, 0);
      const processInfo = await promisify(execFile)('/bin/ps', [
        '-p',
        String(pid),
        '-o',
        'command=',
      ]);
      if (!processInfo.stdout.includes(`--user-data-dir=${join(root, 'desktop-data')}`))
        pid = undefined;
    }
  } catch {
    pid = undefined;
  }
  const url = `codex://threads/${threadId}?hostId=local`;
  if (pid && process.platform === 'darwin') {
    const script = `ObjC.import('AppKit'); var target=$.NSAppleEventDescriptor.descriptorWithProcessIdentifier(${pid}); var event=$.NSAppleEventDescriptor.appleEventWithEventClassEventIDTargetDescriptorReturnIDTransactionID(0x4755524c,0x4755524c,target,-1,0); event.setParamDescriptorForKeyword($.NSAppleEventDescriptor.descriptorWithString(${JSON.stringify(url)}),0x2d2d2d2d); event.sendEventWithOptionsTimeoutError(1,10,null); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}).activateWithOptions($.NSApplicationActivateIgnoringOtherApps);`;
    await promisify(execFile)('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], {
      timeout: 15000,
    });
    return;
  }
  const child = spawn('/bin/bash', [launcher, '', url], { detached: true, stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
};
