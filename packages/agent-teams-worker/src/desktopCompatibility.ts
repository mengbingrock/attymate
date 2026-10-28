import { z } from 'zod';

import type { WorkerCodexAppServerSessionFactory } from './codexAppServerClient';

// Match the desktop startup policy reader. Validate the real response; never synthesize
// an unrestricted network policy when a server lacks this protocol capability.
const requirementsSchema = z.object({
  requirements: z
    .object({
      application: z
        .object({
          network: z
            .object({
              enabled: z.boolean(),
              domains: z.record(
                z
                  .string()
                  .max(253)
                  .regex(
                    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
                  ),
                z.enum(['allow', 'deny'])
              ),
            })
            .nullable(),
        })
        .nullable(),
    })
    .nullable(),
});

export const checkDesktopCompatibility = async (
  factory: WorkerCodexAppServerSessionFactory
): Promise<void> => {
  const session = await factory.open();
  try {
    const response = await session.request('configRequirements/read', {}, 15_000);
    if (!requirementsSchema.safeParse(response).success)
      throw new Error(
        'configRequirements/read did not expose valid application network requirements'
      );
  } catch (error) {
    throw new Error(
      'Cannot open Codex desktop with this App Server: ' +
        (error instanceof Error ? error.message : String(error)) +
        '. Update the selected runtime and stop/start this installation. For stock Codex, reinstall with the desktop app’s bundled Codex server.'
    );
  } finally {
    await session.close();
  }
};
