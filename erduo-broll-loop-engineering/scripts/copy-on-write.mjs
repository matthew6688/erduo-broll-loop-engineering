#!/usr/bin/env node

import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {constants as fsConstants, createReadStream} from 'node:fs';
import {
  chmod, copyFile, cp, lstat, mkdtemp, readdir, rename, rm, stat, utimes,
} from 'node:fs/promises';
import path from 'node:path';

import {isDirectExecution} from './direct-execution.mjs';
import {sanitizedEnvironment} from './safe-spawn.mjs';

const cloneMode = fsConstants.COPYFILE_FICLONE ?? 0;
const forceCloneMode = fsConstants.COPYFILE_FICLONE_FORCE ?? cloneMode;

function nativeMacClone(source, target, {recursive = false} = {}) {
  if (process.platform !== 'darwin') return false;
  const result = spawnSync('/bin/cp', [recursive ? '-cR' : '-c', source, target], {
    env: sanitizedEnvironment(), shell: false, stdio: 'pipe',
  });
  return !result.error && result.status === 0;
}

async function hashFile(file) {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(digest.digest('hex')));
  });
}

export async function cloneFile(source, target, {exclusive = false} = {}) {
  if (exclusive) {
    try {
      await lstat(target);
      const error = new Error(`target already exists: ${target}`);
      error.code = 'EEXIST';
      throw error;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  if (nativeMacClone(source, target)) return;
  await rm(target, {force: true});
  const mode = cloneMode | (exclusive ? fsConstants.COPYFILE_EXCL : 0);
  await copyFile(source, target, mode);
}

export async function cloneTree(source, target) {
  if (nativeMacClone(source, target, {recursive: true})) return;
  await rm(target, {recursive: true, force: true});
  await cp(source, target, {recursive: true, mode: cloneMode});
}

async function enumerate(root, current = root, files = []) {
  for (const entry of await readdir(current, {withFileTypes: true})) {
    if (['.git', 'node_modules', '.cache'].includes(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) await enumerate(root, absolute, files);
    else if (info.isFile()) files.push({file: absolute, bytes: info.size});
  }
  return files;
}

async function replaceWithClone(source, target, expectedHash) {
  const targetInfo = await stat(target);
  const temporaryDirectory = await mkdtemp(path.join(path.dirname(target), '.cow-'));
  const temporary = path.join(temporaryDirectory, path.basename(target));
  try {
    if (!nativeMacClone(source, temporary)) {
      await rm(temporary, {force: true});
      await copyFile(source, temporary, forceCloneMode | fsConstants.COPYFILE_EXCL);
    }
    if (await hashFile(temporary) !== expectedHash) throw new Error(`clone hash mismatch for ${target}`);
    await chmod(temporary, targetInfo.mode);
    await utimes(temporary, targetInfo.atime, targetInfo.mtime);
    await rename(temporary, target);
  } finally {
    await rm(temporaryDirectory, {recursive: true, force: true});
  }
}

export async function deduplicateTree({root, minBytes = 1024 * 1024, apply = false}) {
  const absoluteRoot = path.resolve(root);
  const groupedBySize = new Map();
  for (const item of await enumerate(absoluteRoot)) {
    if (item.bytes < minBytes) continue;
    const group = groupedBySize.get(item.bytes) ?? [];
    group.push(item.file);
    groupedBySize.set(item.bytes, group);
  }

  const duplicates = [];
  for (const [bytes, files] of groupedBySize) {
    if (files.length < 2) continue;
    const groupedByHash = new Map();
    for (const file of files.toSorted()) {
      const sha256 = await hashFile(file);
      const group = groupedByHash.get(sha256) ?? [];
      group.push(file);
      groupedByHash.set(sha256, group);
    }
    for (const [sha256, matches] of groupedByHash) {
      if (matches.length > 1) duplicates.push({sha256, bytes, files: matches});
    }
  }

  let clonedFiles = 0;
  let logicalBytesCloned = 0;
  if (apply) {
    for (const duplicate of duplicates) {
      const [source, ...targets] = duplicate.files;
      for (const target of targets) {
        const [sourceInfo, targetInfo] = await Promise.all([stat(source), stat(target)]);
        if (sourceInfo.dev === targetInfo.dev && sourceInfo.ino === targetInfo.ino) continue;
        try {
          await replaceWithClone(source, target, duplicate.sha256);
        } catch (error) {
          if (['ENOSYS', 'ENOTSUP', 'EXDEV', 'EINVAL'].includes(error?.code)) {
            return {status: 'clone-unsupported', root: absoluteRoot, duplicateGroups: duplicates.length,
              clonedFiles, logicalBytesCloned};
          }
          throw error;
        }
        clonedFiles += 1;
        logicalBytesCloned += duplicate.bytes;
      }
    }
  }
  return {
    status: apply ? 'applied' : 'preview', root: absoluteRoot,
    duplicateGroups: duplicates.length,
    duplicateFiles: duplicates.reduce((sum, item) => sum + item.files.length - 1, 0),
    logicalBytesCloned: apply ? logicalBytesCloned : duplicates.reduce(
      (sum, item) => sum + item.bytes * (item.files.length - 1), 0,
    ),
    clonedFiles,
  };
}

function parseArgs(argv) {
  const values = {apply: false, minBytes: 1024 * 1024};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--apply') values.apply = true;
    else if (value === '--root') values.root = argv[++index];
    else if (value === '--min-bytes') values.minBytes = Number(argv[++index]);
    else throw new Error(`unknown argument ${value}`);
  }
  if (!values.root || !Number.isSafeInteger(values.minBytes) || values.minBytes < 1) {
    throw new Error('--root and a positive integer --min-bytes are required');
  }
  return values;
}

async function main() {
  const result = await deduplicateTree(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
