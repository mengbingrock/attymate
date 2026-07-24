import { atomicWriteAsync } from '@main/utils/atomicWrite';
import { getTeamsBasePath } from '@main/utils/pathDecoder';
import * as fs from 'fs';
import * as path from 'path';

import { parseRuntimeBinding } from '../core/domain/runtimeBinding';

import type { InteractiveRuntimeBinding } from '../core/domain/runtimeBinding';

export function getRuntimeBindingPath(teamName: string): string {
  return path.join(getTeamsBasePath(), teamName, 'interactive-runtime.json');
}

export async function readRuntimeBinding(
  teamName: string
): Promise<InteractiveRuntimeBinding | null> {
  try {
    const raw = await fs.promises.readFile(getRuntimeBindingPath(teamName), 'utf-8');
    return parseRuntimeBinding(raw);
  } catch {
    return null;
  }
}

export async function writeRuntimeBinding(binding: InteractiveRuntimeBinding): Promise<void> {
  const bindingPath = getRuntimeBindingPath(binding.teamName);
  await fs.promises.mkdir(path.dirname(bindingPath), { recursive: true });
  await atomicWriteAsync(bindingPath, JSON.stringify(binding, null, 2));
}

export async function clearRuntimeBinding(teamName: string): Promise<void> {
  await fs.promises.rm(getRuntimeBindingPath(teamName), { force: true }).catch(() => {});
}
