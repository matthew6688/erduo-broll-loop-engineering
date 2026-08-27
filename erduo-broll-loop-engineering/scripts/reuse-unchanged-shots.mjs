#!/usr/bin/env node

import {createHash} from 'node:crypto';
import {lstat, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {canonicalJson} from './runtime-schema-validator.mjs';
import {hashFile, numberedName, readJson, requireRegularFile} from './shot-media-lib.mjs';
import {verifyVideoSkillUsage, writeVideoSkillUsage} from './skill-usage.mjs';
import {isDirectExecution} from './direct-execution.mjs';
import {cloneFile} from './copy-on-write.mjs';

const sha256Json = (value) => `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;

function within(root, locator, label) {
  if (typeof locator !== 'string' || locator.length === 0 || path.isAbsolute(locator)) {
    throw new Error(`${label} must be a non-empty relative locator`);
  }
  const absolute = path.resolve(root, locator);
  const relative = path.relative(path.resolve(root), absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its production root`);
  }
  return absolute;
}

async function loadAssignments(root) {
  const directory = path.join(root, '01-runtime-plan', 'assignments');
  return Promise.all((await readdir(directory, {withFileTypes: true}))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readJson(path.join(directory, entry.name), `assignment ${entry.name}`)));
}

function assignmentOwns(assignment, shotId) {
  return new Set([
    ...(assignment.shotIds ?? []),
    ...(assignment.canaryPhase?.deferredShotIds ?? []),
  ]).has(shotId);
}

async function currentSourceIdentity({root, assignment}) {
  const manifestFile = path.join(root, assignment.output.workDirectory, 'source-manifest.json');
  const manifest = await readJson(manifestFile, `${assignment.assignmentId} source manifest`);
  if (manifest.schemaVersion !== '1.0.0' || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`${assignment.assignmentId} source manifest is invalid`);
  }
  const sourceRoot = within(root, assignment.sourceRoot, 'assignment sourceRoot');
  for (const entry of manifest.files) {
    const file = within(sourceRoot, entry.path, 'source manifest entry');
    await requireRegularFile(file, `source ${entry.path}`);
    if (await hashFile(file) !== entry.sha256) throw new Error(`source ${entry.path} changed after its manifest`);
  }
  return {identity: sha256Json(manifest), manifestFile};
}

async function findPriorContract(root, shotId) {
  const directory = path.join(root, '05-delivery', 'shots');
  const suffix = `-${shotId}.shot-media.json`;
  const matches = (await readdir(directory)).filter((name) => name.endsWith(suffix));
  if (matches.length !== 1) throw new Error(`${shotId} requires exactly one prior shot contract`);
  const contractFile = path.join(directory, matches[0]);
  return {contractFile, contract: await readJson(contractFile, `${shotId} prior shot contract`)};
}

async function assertAbsent(file, label) {
  try {
    await lstat(file);
    throw new Error(`${label} already exists; unchanged-shot reuse never overwrites`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export async function reuseUnchangedShots({
  previousProductionRoot,
  productionRoot,
  planFile = path.join(productionRoot, '01-runtime-plan', 'runtime-plan.json'),
  recipesDirectory = path.join(productionRoot, '01-director', 'shot-recipes'),
  shotIds,
}) {
  const previousRoot = path.resolve(previousProductionRoot);
  const root = path.resolve(productionRoot);
  if (previousRoot === root) throw new Error('previous and current production roots must differ');
  if (!Array.isArray(shotIds) || shotIds.length === 0 || new Set(shotIds).size !== shotIds.length) {
    throw new Error('shotIds must be a non-empty unique list');
  }
  const [plan, previousPlan, assignments] = await Promise.all([
    readJson(path.resolve(planFile), 'current runtime plan'),
    readJson(path.join(previousRoot, '01-runtime-plan', 'runtime-plan.json'), 'previous runtime plan'),
    loadAssignments(root),
  ]);
  if (plan.status !== 'planned' || previousPlan.status !== 'planned') {
    throw new Error('both runtime plans must be planned');
  }
  if (canonicalJson(plan.sourceContext?.skillUsage) !== canonicalJson(previousPlan.sourceContext?.skillUsage)) {
    throw new Error('unchanged-shot reuse requires the exact same Skill usage binding');
  }
  const shotsDirectory = path.join(root, '05-delivery', 'shots');
  const checksDirectory = path.join(root, '05-delivery', 'checks');
  const receiptsDirectory = path.join(root, '05-delivery', 'reuse-receipts');
  await Promise.all([
    mkdir(shotsDirectory, {recursive: true}), mkdir(checksDirectory, {recursive: true}),
    mkdir(receiptsDirectory, {recursive: true}),
  ]);
  const results = [];
  for (const shotId of shotIds) {
    const shotIndex = plan.shots.findIndex((shot) => shot.shotId === shotId);
    const shot = plan.shots[shotIndex];
    if (!shot) throw new Error(`${shotId} is not in the current runtime plan`);
    const assignmentCandidates = assignments.filter((assignment) => assignmentOwns(assignment, shotId));
    const leadCandidate = assignmentCandidates.find((assignment) => assignment.role === 'lead');
    const assignment = leadCandidate ?? assignmentCandidates.find((item) => item.role === 'builder');
    if (!assignment || assignment.planIdentity !== plan.identity) {
      throw new Error(`${shotId} has no current owning Lead/Builder assignment`);
    }
    const source = await currentSourceIdentity({root, assignment});
    const {contract: priorContract, contractFile: priorContractFile} = await findPriorContract(previousRoot, shotId);
    const previousDeliveryRoot = path.join(previousRoot, '05-delivery');
    const priorMedia = within(previousDeliveryRoot, priorContract.media.path, `${shotId} prior media`);
    const priorSheet = within(previousDeliveryRoot, priorContract.semanticCheck.contactSheet, `${shotId} prior sheet`);
    await Promise.all([
      requireRegularFile(priorMedia, `${shotId} prior media`),
      requireRegularFile(priorSheet, `${shotId} prior semantic sheet`),
    ]);
    if (priorContract.sourceIdentity !== source.identity) throw new Error(`${shotId} source identity changed`);
    const recipe = await readJson(path.join(recipesDirectory, `${shotId}.json`), `${shotId} current Recipe`);
    const recipeIdentity = sha256Json(recipe);
    if (priorContract.recipeIdentity !== recipeIdentity) throw new Error(`${shotId} Recipe identity changed`);
    if (priorContract.profileIdentity !== `sha256:${plan.productionProfile.identity}`) {
      throw new Error(`${shotId} production profile changed`);
    }
    if (priorContract.backend !== shot.runtime
      || canonicalJson(priorContract.srtWindowMs) !== canonicalJson({start: shot.window.startMs, end: shot.window.endMs})
      || priorContract.renderTarget?.id !== shotId
      || priorContract.renderTarget?.mode !== 'direct-runtime-render') {
      throw new Error(`${shotId} runtime target or timing changed`);
    }
    if (priorContract.media.sha256 !== await hashFile(priorMedia)
      || priorContract.semanticCheck.sha256 !== await hashFile(priorSheet)) {
      throw new Error(`${shotId} prior media evidence hash is stale`);
    }
    await verifyVideoSkillUsage({
      productionRoot: previousRoot,
      videoFile: priorMedia,
      sidecarFile: `${priorMedia}.skill-usage.json`,
      planIdentity: previousPlan.identity,
      binding: previousPlan.sourceContext.skillUsage,
    });
    const basename = numberedName(shotIndex + 1, shotId, '');
    const mediaFile = path.join(shotsDirectory, `${basename}.mp4`);
    const contractFile = path.join(shotsDirectory, `${basename}.shot-media.json`);
    const sheetFile = path.join(checksDirectory, `${basename}.semantic-check.png`);
    await Promise.all([
      assertAbsent(mediaFile, `${shotId} current media`),
      assertAbsent(contractFile, `${shotId} current contract`),
      assertAbsent(sheetFile, `${shotId} current sheet`),
    ]);
    await Promise.all([
      cloneFile(priorMedia, mediaFile, {exclusive: true}),
      cloneFile(priorSheet, sheetFile, {exclusive: true}),
    ]);
    const unit = plan.authoringUnits.find(({shotIds: ids}) => ids.includes(shotId));
    const contract = {
      ...priorContract,
      order: shotIndex + 1,
      unitId: unit.unitId,
      media: {...priorContract.media, path: `shots/${basename}.mp4`},
      semanticCheck: {
        ...priorContract.semanticCheck,
        sourceMedia: `shots/${basename}.mp4`,
        contactSheet: `checks/${basename}.semantic-check.png`,
      },
    };
    await writeFile(contractFile, `${JSON.stringify(contract, null, 2)}\n`, {flag: 'wx'});
    await writeVideoSkillUsage({
      productionRoot: root,
      videoFile: mediaFile,
      planIdentity: plan.identity,
      binding: plan.sourceContext.skillUsage,
    });
    const receipt = {
      schemaVersion: '1.0.0', status: 'reused-unchanged', shotId,
      previousPlanIdentity: previousPlan.identity, planIdentity: plan.identity,
      sourceIdentity: source.identity, recipeIdentity,
      profileIdentity: contract.profileIdentity, mediaSha256: contract.media.sha256,
      previousContractSha256: await hashFile(priorContractFile),
      currentContractSha256: await hashFile(contractFile),
    };
    receipt.identity = sha256Json(receipt);
    const receiptFile = path.join(receiptsDirectory, `${shotId}.json`);
    await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, {flag: 'wx'});
    results.push({shotId, mediaFile, contractFile, receiptFile});
  }
  return {status: 'reused-unchanged-shots', shots: results};
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || !value) throw new Error(`invalid argument ${name ?? ''}`);
    options[name.slice(2)] = value;
  }
  for (const required of ['from', 'production-root', 'shot-ids']) {
    if (!options[required]) throw new Error(`--${required} is required`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await reuseUnchangedShots({
    previousProductionRoot: options.from,
    productionRoot: options['production-root'],
    planFile: options.plan,
    recipesDirectory: options.recipes,
    shotIds: options['shot-ids'].split(',').map((value) => value.trim()).filter(Boolean),
  });
  process.stdout.write(`${JSON.stringify({status: result.status, shotIds: result.shots.map(({shotId}) => shotId)})}\n`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => {process.stderr.write(`${error.message}\n`); process.exitCode = 1;});
}
