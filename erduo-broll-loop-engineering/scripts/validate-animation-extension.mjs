#!/usr/bin/env node

import {createHash} from 'node:crypto';
import {lstat, readFile, realpath} from 'node:fs/promises';
import path from 'node:path';

import {isDirectExecution} from './direct-execution.mjs';
import {canonicalJson, validateSchemaValue} from './runtime-schema-validator.mjs';

const schemaFile = path.resolve(import.meta.dirname, '..', 'references', 'runtime', 'animation-extension.schema.json');

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!['--root', '--manifest'].includes(name) || !value) throw new Error(`invalid argument ${name ?? ''}`);
    options[name.slice(2)] = value;
  }
  if (!options.root || !options.manifest) throw new Error('--root and --manifest are required');
  return options;
}

function withoutIdentity(value) {
  const copy = structuredClone(value);
  delete copy.identity;
  return copy;
}

export function computeAnimationExtensionIdentity(value) {
  return createHash('sha256').update(canonicalJson(withoutIdentity(value))).digest('hex');
}

async function verifyBinding(root, binding, label) {
  if (path.isAbsolute(binding.locator)) throw new Error(`${label} locator must be relative`);
  const candidate = path.resolve(root, binding.locator);
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} locator escapes the extension root`);
  }
  const info = await lstat(candidate);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  const canonical = await realpath(candidate);
  if (path.relative(root, canonical).startsWith('..')) throw new Error(`${label} resolves outside the extension root`);
  const digest = createHash('sha256').update(await readFile(canonical)).digest('hex');
  if (digest !== binding.sha256) throw new Error(`${label} sha256 does not match`);
}

export async function validateAnimationExtension({root, manifestFile}) {
  const canonicalRoot = await realpath(path.resolve(root));
  const manifestPath = path.resolve(manifestFile);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const schema = JSON.parse(await readFile(schemaFile, 'utf8'));
  const errors = validateSchemaValue(manifest, schema, schema);
  if (errors.length) throw new Error(`animation extension is invalid:\n${errors.join('\n')}`);
  if (manifest.identity !== computeAnimationExtensionIdentity(manifest)) {
    throw new Error('animation extension identity does not match its canonical content');
  }
  const verificationKinds = new Set(manifest.verification.map(({kind}) => kind));
  if (!verificationKinds.has('check-receipt') || !verificationKinds.has('preview')) {
    throw new Error('animation extension requires check-receipt and preview evidence');
  }
  if (manifest.status !== 'candidate' && !manifest.canaryEvidence) {
    throw new Error(`${manifest.status} animation extension requires canary evidence`);
  }
  await verifyBinding(canonicalRoot, manifest.implementation, 'implementation');
  for (const [index, item] of manifest.verification.entries()) {
    await verifyBinding(canonicalRoot, item.artifact, `verification ${index + 1} (${item.kind})`);
  }
  if (manifest.canaryEvidence) await verifyBinding(canonicalRoot, manifest.canaryEvidence.receipt, 'canary receipt');
  return {status: 'verified', id: manifest.id, lifecycle: manifest.status, identity: manifest.identity};
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await validateAnimationExtension({root: options.root, manifestFile: options.manifest});
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => {process.stderr.write(`${error.message}\n`); process.exitCode = 1;});
}
