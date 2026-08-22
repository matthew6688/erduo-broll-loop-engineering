import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !path.isAbsolute(relative)
    && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

async function canonicalRoot(root, label) {
  const lexical = path.resolve(root);
  const info = await lstat(lexical);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} root must be a real non-symlink directory`);
  return realpath(lexical);
}

function lexicalCandidate(root, fileOrLocator, label) {
  if (typeof fileOrLocator !== 'string' || fileOrLocator.length === 0) throw new Error(`${label} path is required`);
  const absoluteInput = path.isAbsolute(fileOrLocator);
  const candidate = absoluteInput ? path.resolve(fileOrLocator) : path.resolve(root, fileOrLocator);
  if (!absoluteInput && !isInside(root, candidate)) throw new Error(`${label} escapes its declared root`);
  return candidate;
}

export async function resolveExistingRegularWithinRoot(root, fileOrLocator, label) {
  const rootReal = await canonicalRoot(root, label);
  const candidate = lexicalCandidate(rootReal, fileOrLocator, label);
  const [candidateReal, info] = await Promise.all([realpath(candidate), lstat(candidate)]);
  if (!isInside(rootReal, candidateReal) || !info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file inside its declared root`);
  }
  return { absolute: candidateReal, locator: path.relative(rootReal, candidateReal).split(path.sep).join('/') };
}

export async function resolveNewOutputWithinRoot(root, fileOrLocator, label) {
  const rootReal = await canonicalRoot(root, label);
  const candidate = lexicalCandidate(rootReal, fileOrLocator, label);
  const parent = path.dirname(candidate);
  const [parentReal, parentInfo] = await Promise.all([realpath(parent), lstat(parent)]);
  if ((parentReal !== rootReal && !isInside(rootReal, parentReal))
    || !parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new Error(`${label} parent must be a real non-symlink directory inside its declared root`);
  }
  const canonicalCandidate = path.join(parentReal, path.basename(candidate));
  try {
    await lstat(canonicalCandidate);
    throw new Error(`${label} already exists`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return { absolute: canonicalCandidate, locator: path.relative(rootReal, canonicalCandidate).split(path.sep).join('/') };
}

export function parseCliPairs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || !value) throw new Error(`invalid argument ${name ?? ''}`);
    options[name.slice(2)] = value;
  }
  return options;
}
