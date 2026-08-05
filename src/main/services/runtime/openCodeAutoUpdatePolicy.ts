/**
 * Legacy persisted-team compatibility. New builds never register or launch the
 * OpenCode runtime, but old runtime records can still be inspected safely.
 */
export function isOpenCodeAutoUpdateAllowed(): boolean {
  return false;
}

export function applyOpenCodeAutoUpdatePolicy<T extends Record<string, string | undefined>>(
  env: T,
  baseEnv: NodeJS.ProcessEnv = process.env
): T & { OPENCODE_DISABLE_AUTOUPDATE: '1' } {
  return { ...baseEnv, ...env, OPENCODE_DISABLE_AUTOUPDATE: '1' };
}
