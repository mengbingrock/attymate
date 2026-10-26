#!/usr/bin/env node
// Stage a built fork package; never resolve the user's stock Codex or download a replacement.
import { createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(`Required: ${flag}`);
  }
  return args[index + 1];
};
const source = resolve(value('--source'));
const bundle = resolve(value('--bundle-dir'));
const platform = value('--platform');
const revision = value('--revision');
if (!['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].includes(platform)) {
  throw new Error(`Unsupported runtime platform: ${platform}`);
}
if (!(await lstat(join(source, 'bin/codex'))).isFile()) {
  throw new Error('Fork package must contain a regular bin/codex executable');
}
const destination = join(bundle, 'codex-runtime', platform);
if (source === destination || destination.startsWith(source + '/')) {
  throw new Error('Output must be outside the source package');
}
await mkdir(join(bundle, 'codex-runtime'), { recursive: true });
// An existing target must be removed deliberately by the release operator, not merged with a new build.
await mkdir(destination);
await cp(source, destination, { recursive: true, dereference: true });
await chmod(join(destination, 'bin/codex'), 0o700);
const files = {};
const visit = async (directory, prefix = '') => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path, relative + '/');
    else if (entry.isFile()) {
      if (relative === 'runtime-manifest.json')
        throw new Error('Source contains a reserved runtime manifest');
      files[relative] = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
    } else throw new Error(`Unsupported runtime package entry: ${relative}`);
  }
};
await visit(destination);
await writeFile(
  join(destination, 'runtime-manifest.json'),
  JSON.stringify({ schemaVersion: 1, platform, revision, files }, null, 2) + '\n'
);
process.stdout.write(`Staged Codex fork ${revision} for ${platform} at ${destination}\n`);
