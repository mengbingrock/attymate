#!/usr/bin/env node
// Run on the certificate owner's Mac after downloading the Actions artifact.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const [directory, identity, notaryProfile] = process.argv.slice(2);
if (process.platform !== 'darwin' || !directory || !identity)
  throw new Error(
    'Usage: node sign-macos-runtime.mjs PACKAGE_DIRECTORY SIGNING_IDENTITY [NOTARY_PROFILE]'
  );
const root = resolve(directory);
const manifestPath = join(root, 'build-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!['aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(manifest.target))
  throw new Error('Not a native macOS runtime package');
const temporary = mkdtempSync(join(tmpdir(), 'agent-teams-sign-'));
try {
  const entitlements = join(temporary, 'runtime.plist');
  // These match the fork's upstream hardened-runtime entitlements for Codex and its V8 host.
  writeFileSync(
    entitlements,
    '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/></dict></plist>'
  );
  for (const name of readdirSync(join(root, 'bin'))) {
    const path = join(root, 'bin', name);
    const key = 'bin/' + name;
    if (createHash('sha256').update(readFileSync(path)).digest('hex') !== manifest.files[key])
      throw new Error('Actions artifact checksum mismatch: ' + key);
    execFileSync(
      'codesign',
      [
        '--force',
        '--options',
        'runtime',
        '--timestamp',
        '--entitlements',
        entitlements,
        '--sign',
        identity,
        path,
      ],
      { stdio: 'inherit' }
    );
    execFileSync('codesign', ['--verify', '--strict', '--verbose=2', path], { stdio: 'inherit' });
    manifest.files[key] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  manifest.signing = 'developer-id';
  manifest.signingIdentity = identity;
  manifest.notarization = 'not-submitted';
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  if (notaryProfile) {
    const archive = join(temporary, 'runtime.zip');
    execFileSync('ditto', ['-c', '-k', '--keepParent', join(root, 'bin'), archive]);
    const result = JSON.parse(
      execFileSync(
        'xcrun',
        [
          'notarytool',
          'submit',
          archive,
          '--keychain-profile',
          notaryProfile,
          '--wait',
          '--output-format',
          'json',
        ],
        { encoding: 'utf8', maxBuffer: 1024 * 1024 }
      )
    );
    if (result.status !== 'Accepted')
      throw new Error('Apple notarization failed: ' + result.status);
    manifest.notarization = 'accepted';
    manifest.notarizationId = result.id;
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('Verified Developer ID signatures. Notarization: ' + manifest.notarization);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
