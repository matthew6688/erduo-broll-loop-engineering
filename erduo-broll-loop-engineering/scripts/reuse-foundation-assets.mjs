#!/usr/bin/env node

import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {isDirectExecution} from './direct-execution.mjs';
import {hashFile, requireRegularFile} from './shot-media-lib.mjs';

function resolveBounded(root, locator, kind) {
  if (typeof locator !== 'string' || path.isAbsolute(locator) || locator.includes('\\')) {
    throw new Error(`${kind} locator must be a portable relative path`);
  }
  const allowedPrefix = kind === 'font' ? '02-assets/fonts/' : '02-assets/licenses/';
  if (!locator.startsWith(allowedPrefix)) throw new Error(`${kind} locator is outside ${allowedPrefix}`);
  const file = path.resolve(root, locator);
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${kind} locator escapes production root`);
  return file;
}

export async function reuseFoundationAssets({sourceProductionRoot, targetProductionRoot}) {
  const startedAt = Date.now();
  const sourceRoot = path.resolve(sourceProductionRoot);
  const targetRoot = path.resolve(targetProductionRoot);
  const gateFile = path.join(sourceRoot, '02-assets', 'gates', 'assets-gate.json');
  await requireRegularFile(gateFile, 'source assets gate');
  const gate = JSON.parse(await readFile(gateFile, 'utf8'));
  if (gate.status !== 'passed') throw new Error('source assets gate is not passed');
  const records = [
    ...(Array.isArray(gate.fonts) ? gate.fonts.map((record) => ({...record, kind: 'font'})) : []),
    ...(Array.isArray(gate.licenses) ? gate.licenses.map((record) => ({...record, kind: 'license'})) : []),
  ].toSorted((left, right) => left.locator.localeCompare(right.locator));
  if (records.length === 0) throw new Error('source assets gate contains no reusable fonts or licenses');

  const copied = [];
  for (const record of records) {
    const source = resolveBounded(sourceRoot, record.locator, record.kind);
    const target = resolveBounded(targetRoot, record.locator, record.kind);
    await requireRegularFile(source, `${record.kind} source`);
    const actual = await hashFile(source);
    if (actual !== record.sha256) throw new Error(`${record.locator} hash mismatch`);
    await mkdir(path.dirname(target), {recursive: true});
    try {
      await copyFile(source, target, 1);
    } catch (error) {
      if (error?.code !== 'EEXIST' || await hashFile(target) !== actual) throw error;
    }
    copied.push({locator: record.locator, sha256: actual, bytes: record.bytes, kind: record.kind});
  }

  const receipt = {
    schemaVersion: '1.0.0', status: 'reused',
    sourceAssetsGate: {sha256: await hashFile(gateFile)},
    files: copied,
    elapsedMs: Date.now() - startedAt,
  };
  const receiptFile = path.join(targetRoot, '02-assets', 'gates', 'foundation-reuse.json');
  await mkdir(path.dirname(receiptFile), {recursive: true});
  await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, {flag: 'wx'});
  return {status: receipt.status, files: copied.length, receiptFile, elapsedMs: receipt.elapsedMs};
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || !value) throw new Error(`invalid argument ${name ?? ''}`);
    values[name.slice(2)] = value;
  }
  return values;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.source || !options.target) throw new Error('--source and --target are required');
  const result = await reuseFoundationAssets({
    sourceProductionRoot: options.source,
    targetProductionRoot: options.target,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
