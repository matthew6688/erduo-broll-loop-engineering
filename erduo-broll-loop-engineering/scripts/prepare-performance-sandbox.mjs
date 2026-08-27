#!/usr/bin/env node

import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {
  lstat, mkdir, readFile, readdir, realpath, rm, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {cloneFile, cloneTree} from './copy-on-write.mjs';
import {isDirectExecution} from './direct-execution.mjs';
import {canonicalJson} from './runtime-schema-validator.mjs';
import {validateRuntimePlan} from './validate-runtime-plan.mjs';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const renderScript = path.join(scriptRoot, 'render-assigned-shots.mjs');

async function hashFile(file) {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(digest.digest('hex')));
  });
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !path.isAbsolute(relative)
    && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function safeRelative(locator, label) {
  if (typeof locator !== 'string' || !locator || path.isAbsolute(locator)) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  const normalized = path.normalize(locator);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`${label} escapes the production root`);
  }
  return normalized;
}

async function requireRegular(file, label) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  return file;
}

async function requireDirectory(directory, label) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a real non-symlink directory`);
  return directory;
}

async function rejectSymlinks(root, current = root) {
  for (const entry of await readdir(current, {withFileTypes: true})) {
    const absolute = path.join(current, entry.name);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error(`benchmark source closure contains a symlink: ${path.relative(root, absolute)}`);
    if (info.isDirectory()) await rejectSymlinks(root, absolute);
  }
}

async function copyFileBinding(sourceRoot, targetRoot, locator, bindings) {
  const relative = safeRelative(locator, 'file locator');
  const source = path.resolve(sourceRoot, relative);
  if (!inside(sourceRoot, source)) throw new Error(`file locator escapes the source root: ${locator}`);
  await requireRegular(source, relative);
  const target = path.resolve(targetRoot, relative);
  if (!inside(targetRoot, target)) throw new Error(`file locator escapes the target root: ${locator}`);
  await mkdir(path.dirname(target), {recursive: true});
  await cloneFile(source, target, {exclusive: true});
  const [sourceSha256, targetSha256] = await Promise.all([hashFile(source), hashFile(target)]);
  if (sourceSha256 !== targetSha256) throw new Error(`copy hash mismatch for ${relative}`);
  bindings.push({locator: relative.split(path.sep).join('/'), sha256: sourceSha256});
}

async function copyTreeBinding(sourceRoot, targetRoot, locator, treeBindings) {
  const relative = safeRelative(locator, 'directory locator');
  const source = path.resolve(sourceRoot, relative);
  if (!inside(sourceRoot, source)) throw new Error(`directory locator escapes the source root: ${locator}`);
  await requireDirectory(source, relative);
  await rejectSymlinks(source);
  const target = path.resolve(targetRoot, relative);
  if (!inside(targetRoot, target)) throw new Error(`directory locator escapes the target root: ${locator}`);
  await mkdir(path.dirname(target), {recursive: true});
  await cloneTree(source, target);
  treeBindings.push(relative.split(path.sep).join('/'));
}

async function readJson(file, label) {
  await requireRegular(file, label);
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new Error(`${label} is not valid JSON`); }
}

async function assignmentRecords(sourceRoot, plan) {
  const directory = path.join(sourceRoot, '01-runtime-plan', 'assignments');
  await requireDirectory(directory, 'assignment directory');
  const canaryIds = new Set(plan.canaryGate?.shotIds ?? []);
  if (canaryIds.size !== 5) throw new Error('performance sandbox requires exactly five canary shots');
  const records = [];
  for (const entry of (await readdir(directory, {withFileTypes: true})).toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || path.extname(entry.name) !== '.json') continue;
    const locator = path.join('01-runtime-plan', 'assignments', entry.name);
    const value = await readJson(path.join(sourceRoot, locator), `${entry.name} assignment`);
    const activeCanaryIds = (value.canaryPhase?.mode === 'canary-first' ? value.canaryPhase.shotIds : []) ?? [];
    if (!activeCanaryIds.some((shotId) => canaryIds.has(shotId))) continue;
    if (value.planIdentity !== plan.identity) throw new Error(`${value.assignmentId} does not bind the runtime plan`);
    if (!['lead', 'builder'].includes(value.role)) throw new Error(`${value.assignmentId} has an invalid benchmark role`);
    const sourceLocator = safeRelative(value.sourceRoot, `${value.assignmentId} sourceRoot`);
    const runtime = value.runtime;
    const executable = value.runtimeExecutable;
    if (!['hyperframes', 'remotion'].includes(runtime)
      || executable?.verified !== true || typeof executable.locator !== 'string'
      || !/^[0-9a-f]{64}$/u.test(executable.sha256 ?? '')) {
      throw new Error(`${value.assignmentId} lacks a verified runtime executable`);
    }
    await requireRegular(path.resolve(executable.locator), `${value.assignmentId} runtime executable`);
    if (await hashFile(path.resolve(executable.locator)) !== executable.sha256) {
      throw new Error(`${value.assignmentId} runtime executable hash drifted`);
    }
    records.push({locator, value, sourceLocator, activeCanaryIds});
  }
  const coverage = new Set(records.flatMap(({activeCanaryIds}) => activeCanaryIds));
  if (coverage.size !== 5 || [...canaryIds].some((shotId) => !coverage.has(shotId))) {
    throw new Error('selected canary-first assignments do not cover the exact five-shot canary');
  }
  return records.sort((left, right) => {
    const roleOrder = {lead: 0, builder: 1};
    return roleOrder[left.value.role] - roleOrder[right.value.role]
      || left.value.assignmentId.localeCompare(right.value.assignmentId);
  });
}

function validationFiles(root, plan) {
  const locate = (fallback, binding) => path.join(root, binding?.locator ?? fallback);
  return {
    narrativeEnvelopeFile: path.join(root, '01-director', 'narrative-envelope.json'),
    visualSystemFile: path.join(root, '01-director', 'visual-system.json'),
    representativeScenesFile: path.join(root, '01-director', 'representative-scenes.json'),
    motionMapFile: path.join(root, '01-director', 'motion-map.json'),
    recipesDirectory: path.join(root, '01-director', 'shot-recipes'),
    originalSrtFile: locate('00-inputs/original.srt', plan.sourceContext?.originalSrt),
    originalDesignFile: locate('00-inputs/original-design.md', plan.sourceContext?.originalDesign),
    ...(plan.sourceContext?.materialPolicy
      ? {materialPolicyFile: locate('00-inputs/material-policy.json', plan.sourceContext.materialPolicy)} : {}),
    productionRoot: root,
  };
}

export async function preparePerformanceSandbox({
  sourceRoot, targetRoot, validatePlan = validateRuntimePlan,
}) {
  const source = await realpath(path.resolve(sourceRoot));
  await requireDirectory(source, 'source production root');
  const target = path.resolve(targetRoot);
  const targetParent = await realpath(path.dirname(target));
  const canonicalTarget = path.join(targetParent, path.basename(target));
  if (inside(source, canonicalTarget) || inside(canonicalTarget, source) || source === canonicalTarget) {
    throw new Error('benchmark target must be outside the source production root');
  }
  try { await lstat(canonicalTarget); throw new Error('benchmark target already exists'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }

  const planLocator = '01-runtime-plan/runtime-plan.json';
  const plan = await readJson(path.join(source, planLocator), 'runtime plan');
  if (plan.schemaVersion !== '4.0.0' || plan.status !== 'planned') {
    throw new Error('performance sandbox requires a planned Recipe v4 runtime plan');
  }
  if (plan.sourceContext?.presenterSource || plan.sourceContext?.presentationMode) {
    throw new Error('performance sandbox v1 supports pure B-roll only');
  }
  const assignments = await assignmentRecords(source, plan);
  const fileBindings = [];
  const treeBindings = [];
  await mkdir(canonicalTarget, {recursive: false});
  try {
    const inputLocators = new Set([
      plan.sourceContext?.originalSrt?.locator ?? '00-inputs/original.srt',
      plan.sourceContext?.originalDesign?.locator ?? '00-inputs/original-design.md',
      plan.sourceContext?.skillUsage?.locator ?? '00-inputs/skill-usage.json',
      plan.sourceContext?.productionGovernance?.contractLocator ?? '00-inputs/production-governance.json',
      ...(plan.sourceContext?.materialPolicy ? [plan.sourceContext.materialPolicy.locator] : []),
    ]);
    for (const locator of inputLocators) await copyFileBinding(source, canonicalTarget, locator, fileBindings);
    for (const locator of ['production-profile.json', 'production-governance.lock.json', planLocator]) {
      await copyFileBinding(source, canonicalTarget, locator, fileBindings);
    }
    await copyTreeBinding(source, canonicalTarget, '01-director', treeBindings);
    await copyTreeBinding(source, canonicalTarget, '02-assets', treeBindings);
    for (const assignment of assignments) {
      await copyFileBinding(source, canonicalTarget, assignment.locator, fileBindings);
      await copyTreeBinding(source, canonicalTarget, assignment.sourceLocator, treeBindings);
    }

    const copiedPlan = await readJson(path.join(canonicalTarget, planLocator), 'copied runtime plan');
    await validatePlan(copiedPlan, validationFiles(canonicalTarget, copiedPlan));

    const commands = assignments.map(({locator, value, sourceLocator, activeCanaryIds}) => ({
      assignmentId: value.assignmentId,
      role: value.role,
      shotIds: [...activeCanaryIds],
      executable: process.execPath,
      args: [
        renderScript,
        '--plan', path.join(canonicalTarget, planLocator),
        '--assignment', path.join(canonicalTarget, locator),
        '--recipes', path.join(canonicalTarget, '01-director', 'shot-recipes'),
        '--source-root', path.join(canonicalTarget, sourceLocator),
        '--production-root', canonicalTarget,
        `--${value.runtime}`, value.runtimeExecutable.locator,
      ],
    }));
    const manifest = {
      schemaVersion: '1.0.0', status: 'prepared', purpose: 'non-production-performance-sandbox',
      planIdentity: plan.identity, canaryShotIds: [...plan.canaryGate.shotIds],
      exclusions: [
        'visual-plan-approval', 'user-canary-decision', 'view-receipts', 'delivery-media',
        'production-events', 'render-attempt-ledgers',
      ],
      fileBindings: fileBindings.toSorted((a, b) => a.locator.localeCompare(b.locator)),
      treeBindings: [...new Set(treeBindings)].toSorted(), commands,
    };
    manifest.identity = createHash('sha256').update(canonicalJson(manifest)).digest('hex');
    await writeFile(path.join(canonicalTarget, 'performance-sandbox.json'), `${JSON.stringify(manifest, null, 2)}\n`, {flag: 'wx'});
    return {status: 'prepared', targetRoot: canonicalTarget, manifest};
  } catch (error) {
    await rm(canonicalTarget, {recursive: true, force: true});
    throw error;
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!['--source-root', '--target-root'].includes(name) || !value) throw new Error(`invalid argument ${name ?? ''}`);
    values[name.slice(2)] = value;
  }
  if (!values['source-root'] || !values['target-root']) {
    throw new Error('--source-root and --target-root are required');
  }
  return values;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await preparePerformanceSandbox({
    sourceRoot: options['source-root'], targetRoot: options['target-root'],
  });
  process.stdout.write(`${JSON.stringify({status: result.status, targetRoot: result.targetRoot, identity: result.manifest.identity})}\n`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
