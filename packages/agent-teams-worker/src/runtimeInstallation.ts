import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import {
  access,
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { validateCodexMcpServerName } from './codexMcpServerNames';
import { withCodexConfigLock } from './codexConfigTransaction';

const exec = promisify(execFile);
export const runtimeKindSchema = z.enum(['stock', 'fork']);
export const serverOwnershipSchema = z.enum(['managed', 'external']);
export const messageDeliveryModeSchema = z.enum(['inline', 'mcp-inbox']);
export const runtimeInstallationSchema = z
  .object({
    schemaVersion: z.literal(1),
    installationId: z.uuid(),
    runtimeKind: runtimeKindSchema,
    serverOwnership: serverOwnershipSchema,
    appServerMode: z.enum(['private-stdio', 'shared-daemon']),
    endpoint: z.string().min(1).optional(),
    controlSocketPath: z.string().min(1).optional(),
    runtimeCwd: z.string().min(1).optional(),
    codexHome: z.string().min(1),
    binaryPath: z.string().min(1),
    resolvedBinaryPath: z.string().min(1),
    binaryVersion: z.string().min(1),
    controlMcpName: z.string().transform((name) => validateCodexMcpServerName(name)),
    messageDeliveryMode: messageDeliveryModeSchema.optional(),
    controlMcpTarget: z
      .object({ command: z.string().min(1), args: z.array(z.string()), cwd: z.string().optional() })
      .strict()
      .optional(),
    serverVersion: z.string().optional(),
    serverIdentity: z.enum(['local-process', 'version-matched', 'unverified-endpoint']).optional(),
    checkedAt: z.iso.datetime(),
    checks: z.array(z.string()),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.serverOwnership === 'external' &&
      (value.appServerMode !== 'shared-daemon' || !value.endpoint)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'External App Server ownership requires a shared-daemon endpoint',
      });
    }
    for (const path of [value.codexHome, value.binaryPath, value.resolvedBinaryPath]) {
      if (!isAbsolute(path))
        context.addIssue({
          code: 'custom',
          message: 'Runtime installation paths must be absolute',
        });
    }
  });
export type RuntimeInstallation = z.infer<typeof runtimeInstallationSchema>;

const descriptorPath = (dataDir: string): string => join(dataDir, 'runtime-installation.json');

export const readRuntimeInstallation = async (
  dataDir: string
): Promise<RuntimeInstallation | undefined> => {
  try {
    const stat = await lstat(descriptorPath(dataDir));
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Runtime installation metadata must be a regular file');
    return runtimeInstallationSchema.parse(
      JSON.parse(await readFile(descriptorPath(dataDir), 'utf8'))
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
};

export const writeRuntimeInstallation = async (
  dataDir: string,
  installation: RuntimeInstallation
): Promise<void> =>
  withCodexConfigLock(descriptorPath(dataDir), async () => {
    const parsed = runtimeInstallationSchema.parse(installation);
    if (
      parsed.serverOwnership === 'external' &&
      (parsed.appServerMode !== 'shared-daemon' || !parsed.endpoint)
    ) {
      throw new Error('External App Server ownership requires a shared-daemon endpoint');
    }
    const previous = await readRuntimeInstallation(dataDir);
    if (
      previous &&
      (previous.runtimeKind !== parsed.runtimeKind ||
        previous.installationId !== parsed.installationId)
    ) {
      throw new Error(
        'This data directory belongs to another runtime installation; choose a separate --data-dir'
      );
    }
    const temporary = `${descriptorPath(dataDir)}.${randomUUID()}.tmp`;
    try {
      // Startup may have begun before setup registered its control target. Registration ownership
      // is monotonic here; only the dedicated setup transaction updates that target.
      const merged = {
        ...parsed,
        ...(previous?.controlMcpTarget ? { controlMcpTarget: previous.controlMcpTarget } : {}),
      };
      await writeFile(temporary, JSON.stringify(merged, null, 2) + '\n', {
        mode: 0o600,
        flag: 'wx',
      });
      if (previous) {
        await rename(temporary, descriptorPath(dataDir));
      } else {
        try {
          await link(temporary, descriptorPath(dataDir));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const winner = await readRuntimeInstallation(dataDir);
          if (
            winner?.installationId !== parsed.installationId ||
            winner.runtimeKind !== parsed.runtimeKind
          ) {
            throw new Error('Another runtime installation claimed this data directory');
          }
        }
      }
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  });

export const saveRuntimeControlMcpTarget = async (
  dataDir: string,
  serverName: string,
  target: NonNullable<RuntimeInstallation['controlMcpTarget']>
): Promise<void> =>
  withCodexConfigLock(descriptorPath(dataDir), async () => {
    const current = await readRuntimeInstallation(dataDir);
    if (!current || current.controlMcpName !== serverName)
      throw new Error('Control registration does not match the saved installation');
    const next = runtimeInstallationSchema.parse({ ...current, controlMcpTarget: target });
    const path = descriptorPath(dataDir);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  });

export const inspectRuntimeBinary = async (
  binary: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ binaryPath: string; resolvedBinaryPath: string; binaryVersion: string }> => {
  const candidates =
    isAbsolute(binary) || binary.includes('/') || binary.includes('\\')
      ? [resolve(binary)]
      : (env.PATH ?? '')
          .split(delimiter)
          .filter(Boolean)
          .flatMap((directory) =>
            process.platform === 'win32'
              ? [join(directory, binary), join(directory, `${binary}.exe`)]
              : [join(directory, binary)]
          );
  let binaryPath: string | undefined;
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      binaryPath = candidate;
      break;
    } catch {
      /* Try the next PATH entry. */
    }
  }
  if (!binaryPath) throw new Error(`Codex executable not found: ${binary}; provide --codex-binary`);
  const result = await exec(binaryPath, ['--version'], {
    env,
    timeout: 15_000,
    maxBuffer: 256 * 1024,
    windowsHide: true,
  });
  const binaryVersion = /\bcodex-cli\s+(\S+)/.exec(result.stdout)?.[1];
  if (!binaryVersion) throw new Error('The selected executable did not report a Codex CLI version');
  return { binaryPath, resolvedBinaryPath: await realpath(binaryPath), binaryVersion };
};

const identitySchema = z
  .object({
    organizationId: z.uuid(),
    personId: z.uuid(),
    nodeId: z.uuid(),
    workerInstanceId: z.uuid(),
  })
  .strict();

/** A direct-source Worker keeps its enrollment identity across restarts, too. */
export const prepareWorkerIdentity = async (
  dataDir: string,
  overrides: Partial<z.infer<typeof identitySchema>>
): Promise<z.infer<typeof identitySchema>> => {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, 'worker-identity.json');
  const read = async () => identitySchema.parse(JSON.parse(await readFile(path, 'utf8')));
  try {
    const previous = await read();
    for (const [name, value] of Object.entries(overrides)) {
      if (value !== undefined && previous[name as keyof typeof previous] !== value) {
        throw new Error(
          `Worker ${name} differs from this data directory's saved identity; choose a separate --data-dir`
        );
      }
    }
    return previous;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const created = identitySchema.parse({
    organizationId: overrides.organizationId ?? randomUUID(),
    personId: overrides.personId ?? randomUUID(),
    nodeId: overrides.nodeId ?? randomUUID(),
    workerInstanceId: overrides.workerInstanceId ?? randomUUID(),
  });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(created, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    try {
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      return prepareWorkerIdentity(dataDir, overrides);
    }
    return created;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
};
