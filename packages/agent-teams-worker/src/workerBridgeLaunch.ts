import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface WorkerBridgeLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly entryPath: string;
}

export const resolveWorkerBridgeLaunch = (
  parentModuleUrl: string,
  bridgeName: string,
  options: {
    readonly fileExists?: (path: string) => boolean;
    readonly nodePath?: string;
    readonly nodeExecArgv?: readonly string[];
  } = {}
): WorkerBridgeLaunch => {
  const fileExists = options.fileExists ?? existsSync;
  const nodePath = options.nodePath ?? process.execPath;
  const compiledPath = fileURLToPath(new URL(`./${bridgeName}.js`, parentModuleUrl));
  if (fileExists(compiledPath)) {
    return { command: nodePath, args: [compiledPath], entryPath: compiledPath };
  }

  const sourcePath = fileURLToPath(new URL(`./${bridgeName}.ts`, parentModuleUrl));
  if (!fileExists(sourcePath)) {
    throw new Error(`Worker bridge entrypoint is missing: ${compiledPath} or ${sourcePath}`);
  }
  return {
    command: nodePath,
    args: [...(options.nodeExecArgv ?? process.execArgv), sourcePath],
    entryPath: sourcePath,
  };
};
