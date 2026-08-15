import { readFile } from 'node:fs/promises';

import {
  readCodexMcpRegistrationState,
  type CodexMcpRegistrationState,
} from './codexMcpRegistration';
import { requestWorkerControl } from './workerControlServer';
import type { AgentTeamsWorkerStatus } from './workerDaemon';

export interface WorkerDiagnosticReport {
  readonly ok: boolean;
  readonly codexMcp: {
    readonly configPath: string;
    readonly state: CodexMcpRegistrationState;
  };
  readonly persistedStatus:
    | { readonly available: true; readonly status: AgentTeamsWorkerStatus }
    | { readonly available: false; readonly error: string };
  readonly controlSocket:
    | { readonly reachable: true; readonly socketPath: string; readonly status: AgentTeamsWorkerStatus }
    | { readonly reachable: false; readonly socketPath: string; readonly error: string };
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const diagnoseAgentTeamsWorker = async (input: {
  readonly codexConfigPath: string;
  readonly statusPath: string;
  readonly controlSocketPath: string;
}): Promise<WorkerDiagnosticReport> => {
  const codexState = await readCodexMcpRegistrationState(input.codexConfigPath);
  let persistedStatus: WorkerDiagnosticReport['persistedStatus'];
  try {
    persistedStatus = {
      available: true,
      status: JSON.parse(await readFile(input.statusPath, 'utf8')) as AgentTeamsWorkerStatus,
    };
  } catch (error) {
    persistedStatus = { available: false, error: errorMessage(error) };
  }

  let controlSocket: WorkerDiagnosticReport['controlSocket'];
  try {
    controlSocket = {
      reachable: true,
      socketPath: input.controlSocketPath,
      status: await requestWorkerControl<AgentTeamsWorkerStatus>(
        input.controlSocketPath,
        '/v2/worker-status'
      ),
    };
  } catch (error) {
    controlSocket = {
      reachable: false,
      socketPath: input.controlSocketPath,
      error: errorMessage(error),
    };
  }

  return {
    ok: codexState.status === 'managed' && controlSocket.reachable,
    codexMcp: { configPath: input.codexConfigPath, state: codexState },
    persistedStatus,
    controlSocket,
  };
};
