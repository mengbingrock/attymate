const DROP_FLAGS = new Set(['--print', '--verbose']);
const DROP_FLAGS_WITH_VALUE = new Set([
  '--input-format',
  '--output-format',
  '--permission-prompt-tool',
]);

/**
 * Derive interactive-TUI CLI args from the headless stream-json arg vector:
 * strip print/stream plumbing, keep everything else (mcp config, permissions,
 * model/effort, settings), and pin tmux teammate mode so every teammate gets
 * an attachable pane.
 */
export function buildInteractiveCliArgs(headlessArgs: readonly string[]): string[] {
  const args: string[] = [];
  let index = 0;
  while (index < headlessArgs.length) {
    const arg = headlessArgs[index];
    index += 1;
    if (DROP_FLAGS.has(arg)) continue;
    if (DROP_FLAGS_WITH_VALUE.has(arg)) {
      index += 1;
      continue;
    }
    args.push(arg);
  }
  args.push('--teammate-mode', 'tmux');
  return args;
}
