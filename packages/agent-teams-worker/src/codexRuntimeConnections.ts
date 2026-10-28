import { lstat, readFile } from 'node:fs/promises';

import { z } from 'zod';

import { isOwnerControlServerName } from './codexMcpServerNames';

const names = z.array(z.string().min(1)).min(1);
const server = z
  .object({
    enabledTools: names.optional(),
    env: z.record(z.string(), z.string()).optional(),
    approvalMode: z.enum(['prompt', 'approve']).default('prompt'),
    readOnly: z.boolean().default(false),
    launch: z
      .object({
        command: z.string().min(1),
        args: z.array(z.string()).max(64).default([]),
        cwd: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Owner-selected connections. Credentials stay in the selected Codex home/provider. */
export const runtimeConnectionPolicySchema = z
  .object({
    mcpServers: z.record(z.string().min(1), server).default({}),
    plugins: z
      .record(
        z.string().min(1),
        z
          .object({
            mcpServers: z
              .record(
                z.string().min(1),
                z
                  .object({
                    inventoryName: z.string().min(1),
                    enabledTools: names,
                  })
                  .strict()
              )
              .default({}),
          })
          .strict()
      )
      .default({}),
    apps: z
      .record(
        z.string().min(1),
        z
          .object({
            enabledTools: names,
            readOnly: z.boolean().default(true),
            expectedEmail: z.email().optional(),
          })
          .strict()
      )
      .default({}),
  })
  .strict()
  .superRefine((policy, context) => {
    const reserved = ['agent-teams-control', 'agent-teams-runtime', 'codex_apps', '_codex_apps'];
    const selected = [
      ...Object.keys(policy.mcpServers),
      ...Object.values(policy.plugins).flatMap((plugin) =>
        Object.values(plugin.mcpServers).map((value) => value.inventoryName)
      ),
    ];
    for (const name of selected) {
      if (reserved.includes(name) || isOwnerControlServerName(name))
        context.addIssue({ code: 'custom', message: `Reserved MCP server ${name}` });
    }
    if (new Set(selected).size !== selected.length)
      context.addIssue({ code: 'custom', message: 'Connection server names must be unique' });
  });

export type CodexRuntimeConnectionPolicy = z.infer<typeof runtimeConnectionPolicySchema>;

export const runtimeConnectionFeatures = (
  policy?: CodexRuntimeConnectionPolicy
): Readonly<Record<string, boolean>> => {
  const apps = Object.keys(policy?.apps ?? {}).length > 0;
  const plugins = Object.keys(policy?.plugins ?? {}).length > 0;
  return { apps, plugins, remote_plugin: plugins };
};

export const readRuntimeConnectionPolicy = async (
  path: string
): Promise<CodexRuntimeConnectionPolicy> => {
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
  )
    throw new Error('Runtime connection policy must be an owner-only regular file (0600).');
  return runtimeConnectionPolicySchema.parse(JSON.parse(await readFile(path, 'utf8')));
};
