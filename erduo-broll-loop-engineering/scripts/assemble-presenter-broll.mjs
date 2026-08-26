#!/usr/bin/env node

import { link, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { probeAudioVisual } from './create-presenter-source.mjs';
import { compilePresenterSegments } from './create-presenter-edit-plan.mjs';
import { canonicalJson, validateSchemaValue } from './runtime-schema-validator.mjs';
import {
  commandFailure, hashFile, probeAndDecode, readJson, requireRegularFile, runCommand,
} from './shot-media-lib.mjs';
import {
  parseCliPairs, presenterKindOf, resolveExistingRegularWithinRoot, resolveNewOutputWithinRoot,
} from './presenter-media-lib.mjs';
import { computeRecipeIdentity, computeRecipeTruthIdentity } from './validate-shot-recipes.mjs';
import { computeRuntimePlanIdentity } from './validate-runtime-plan.mjs';
import {verifyVideoSkillUsage, writeVideoSkillUsage} from './skill-usage.mjs';
import {isDirectExecution} from './direct-execution.mjs';

const schemas = path.resolve(import.meta.dirname, '..', 'references', 'runtime');

async function assertSchema(value, name, label) {
  const schema = await readJson(path.join(schemas, name), `${label} schema`);
  const errors = validateSchemaValue(value, schema, schema);
  if (errors.length) throw new Error(`${label} failed schema validation:\n- ${errors.join('\n- ')}`);
}

export function validatePresenterEditPlan({ plan, shots, presenterDurationMs }) {
  if (!plan?.segments?.length) throw new Error('presenter edit plan has no segments');
  let cursor = 0;
  let presenterMs = 0;
  let brollMs = 0;
  for (const [index, segment] of plan.segments.entries()) {
    if (segment.startMs !== cursor) throw new Error(`segment ${index + 1} creates a timeline gap or overlap at ${cursor}ms`);
    if (!Number.isInteger(segment.endMs) || segment.endMs <= segment.startMs) throw new Error(`segment ${index + 1} has an invalid time window`);
    const duration = segment.endMs - segment.startMs;
    if (segment.kind === 'presenter') {
      if ('shotId' in segment) throw new Error(`presenter segment ${index + 1} must not declare shotId`);
      presenterMs += duration;
    } else if (segment.kind === 'broll') {
      if (!segment.shotId) throw new Error(`B-roll segment ${index + 1} requires shotId`);
      const shot = shots.get(segment.shotId);
      if (!shot) throw new Error(`B-roll segment ${index + 1} references unknown shot ${segment.shotId}`);
      const window = shot.srtWindowMs;
      if (segment.startMs < window.start || segment.endMs > window.end) {
        throw new Error(`B-roll segment ${index + 1} is outside ${segment.shotId} SRT window`);
      }
      brollMs += duration;
    } else {
      throw new Error(`segment ${index + 1} has unsupported kind`);
    }
    cursor = segment.endMs;
  }
  if (cursor > presenterDurationMs) throw new Error('edit plan extends beyond presenter media duration');
  return { durationMs: cursor, presenterDurationMs: presenterMs, brollDurationMs: brollMs };
}

async function verifyCompiledPlanBindings({ productionRoot, sourceRecord, source, plan }) {
  if (plan.presenterSource.file !== sourceRecord.locator
    || plan.presenterSource.sha256 !== await hashFile(sourceRecord.absolute)
    || plan.presenterSource.mediaSha256 !== source.media.sha256) {
    throw new Error('presenter edit plan is not bound to the current presenter source contract');
  }
  if (plan.compositionScope === 'framework-demo'
    && (source.authorization.use !== 'internal-framework-demo'
      || source.approval.scope !== 'framework-demo'
      || source.approval.lipSync !== 'not-evaluated')) {
    throw new Error('framework-demo composition requires isolated demo authorization, demo approval, and unevaluated lip sync');
  }
  if (plan.compositionScope === 'canary'
    && (source.authorization.use !== 'internal-canary'
      || source.approval.scope !== 'canary'
      || source.approval.lipSync !== 'approved')) {
    throw new Error('canary composition requires internal-canary authorization and approved canary lip sync');
  }
  if (plan.compositionScope === 'full-production'
    && (source.authorization.use !== 'publishing' || source.approval.scope !== 'full-production')) {
    throw new Error('full-production composition requires publishing authorization and full-production approval');
  }
  const runtimeRecord = await resolveExistingRegularWithinRoot(productionRoot, plan.runtimePlan.file, 'bound runtime plan');
  const runtimePlan = await readJson(runtimeRecord.absolute, 'bound runtime plan');
  if (await hashFile(runtimeRecord.absolute) !== plan.runtimePlan.sha256
    || runtimePlan.identity !== plan.runtimePlan.identity
    || computeRuntimePlanIdentity(runtimePlan) !== runtimePlan.identity) {
    throw new Error('presenter edit plan runtime plan binding changed');
  }
  if (runtimePlan.sourceContext?.originalSrt?.sha256 !== source.inputIdentity.srt.sha256) {
    throw new Error('bound runtime plan original SRT differs from the presenter source SRT');
  }
  const plannedPresenter = runtimePlan.sourceContext?.presenterSource;
  if (!plannedPresenter || plannedPresenter.locator !== sourceRecord.locator
    || plannedPresenter.sha256 !== plan.presenterSource.sha256
    || plannedPresenter.mediaSha256 !== source.media.sha256
    || presenterKindOf(plannedPresenter) !== presenterKindOf(source)) {
    throw new Error('bound runtime plan presenter source differs from the composition source');
  }
  const expectedOutput = {
    width: runtimePlan.productionProfile?.raster?.width,
    height: runtimePlan.productionProfile?.raster?.height,
    fps: runtimePlan.productionProfile?.fps?.numerator / runtimePlan.productionProfile?.fps?.denominator,
  };
  if (plan.output.width !== expectedOutput.width || plan.output.height !== expectedOutput.height
    || Math.abs(plan.output.fps - expectedOutput.fps) > 1e-6) {
    throw new Error('presenter edit plan output differs from the bound runtime production profile');
  }
  const boundShotIds = new Set();
  const boundRecipes = [];
  for (const binding of plan.recipes) {
    if (boundShotIds.has(binding.shotId)) throw new Error(`presenter edit plan repeats Recipe ${binding.shotId}`);
    boundShotIds.add(binding.shotId);
    const recipeRecord = await resolveExistingRegularWithinRoot(productionRoot, binding.file, `${binding.shotId} Recipe`);
    const recipe = await readJson(recipeRecord.absolute, `${binding.shotId} Recipe`);
    if (recipe.shotId !== binding.shotId
      || computeRecipeIdentity(recipe) !== binding.recipeIdentity
      || computeRecipeTruthIdentity(recipe) !== binding.truthIdentity) {
      throw new Error(`${binding.shotId} Recipe changed after presenter edit plan compilation`);
    }
    boundRecipes.push(recipe);
  }
  for (const segment of plan.segments) {
    if (segment.kind === 'broll' && !boundShotIds.has(segment.shotId)) {
      throw new Error(`B-roll segment references unbound Recipe ${segment.shotId}`);
    }
  }
  const compiledSegments = compilePresenterSegments(boundRecipes, source.media.durationMs);
  if (canonicalJson(plan.segments) !== canonicalJson(compiledSegments)) {
    throw new Error('presenter edit plan segments differ from the bound Recipe presenter treatments');
  }
  const skillUsageBinding = runtimePlan.sourceContext?.skillUsage;
  if (!skillUsageBinding) throw new Error('presenter composition requires runtime-plan skill usage binding');
  return {runtimePlan, skillUsageBinding};
}

function seconds(ms) {
  return (ms / 1000).toFixed(6).replace(/0+$/u, '').replace(/\.$/u, '');
}

function normalizedVideoFilter({ input, startMs, endMs, width, height, fps, output }) {
  return `[${input}:v:0]trim=start=${seconds(startMs)}:end=${seconds(endMs)},setpts=PTS-STARTPTS,`
    + `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,`
    + `setsar=1,fps=${fps},format=yuv420p[${output}]`;
}

async function loadVerifiedShots({
  productionRoot, deliveryRoot, deliveryIndex, planIdentity, skillUsageBinding,
  ffmpeg, ffprobe, runner,
}) {
  const shots = new Map();
  for (const indexed of deliveryIndex.shots) {
    if (shots.has(indexed.shotId)) throw new Error(`delivery index repeats shot ${indexed.shotId}`);
    const [contractRecord, mediaRecord] = await Promise.all([
      resolveExistingRegularWithinRoot(deliveryRoot, indexed.contract, `${indexed.shotId} contract`),
      resolveExistingRegularWithinRoot(deliveryRoot, indexed.file, `${indexed.shotId} media`),
    ]);
    const contractPath = contractRecord.absolute;
    const mediaPath = mediaRecord.absolute;
    const contract = await readJson(contractPath, `${indexed.shotId} contract`);
    await assertSchema(contract, 'shot-media.schema.json', `${indexed.shotId} contract`);
    if (contract.shotId !== indexed.shotId || contract.media.path !== indexed.file
      || contract.srtWindowMs.start !== indexed.srtWindowMs.start
      || contract.srtWindowMs.end !== indexed.srtWindowMs.end
      || contract.renderTarget?.mode !== 'direct-runtime-render' || contract.media.fullDecode !== 'passed') {
      throw new Error(`${indexed.shotId} delivery index and shot contract disagree`);
    }
    const mediaSha256 = await hashFile(mediaPath);
    if (mediaSha256 !== contract.media.sha256) throw new Error(`${indexed.shotId} media hash changed before presenter composition`);
    await verifyVideoSkillUsage({
      productionRoot, videoFile: mediaPath, planIdentity, binding: skillUsageBinding,
    });
    const facts = await probeAndDecode(mediaPath, {
      ffmpeg, ffprobe, runner, cwd: path.dirname(mediaPath), shotId: `${indexed.shotId} B-roll`,
    });
    const frameTolerance = 1000 / contract.media.fps + 1;
    if (facts.audioStreams !== 0 || facts.codec !== contract.media.codec
      || facts.width !== contract.media.width || facts.height !== contract.media.height
      || Math.abs(facts.fps - contract.media.fps) > 1e-6
      || facts.frameCount !== contract.localTimeline.frameCount
      || Math.abs(facts.durationMs - contract.media.durationMs) > frameTolerance) {
      throw new Error(`${indexed.shotId} measured B-roll facts differ from its shot contract`);
    }
    shots.set(indexed.shotId, { ...indexed, contract, mediaPath, mediaSha256 });
  }
  return shots;
}

export async function assemblePresenterBroll({
  productionRoot,
  presenterSourceFile,
  editPlanFile,
  deliveryIndexFile,
  deliveryRoot = path.join(productionRoot, '05-delivery'),
  outputFile = path.join(deliveryRoot, 'presenter-broll-master.mp4'),
  receiptFile = path.join(deliveryRoot, 'presenter-broll-master.receipt.json'),
  ffmpeg = 'ffmpeg',
  ffprobe = 'ffprobe',
  runner = runCommand,
}) {
  for (const [label, value] of Object.entries({ productionRoot, presenterSourceFile, editPlanFile, deliveryIndexFile })) {
    if (!value) throw new Error(`${label} is required`);
  }
  const [sourceRecord, planRecord, indexRecord, output, receipt] = await Promise.all([
    resolveExistingRegularWithinRoot(productionRoot, presenterSourceFile, 'presenter source contract'),
    resolveExistingRegularWithinRoot(productionRoot, editPlanFile, 'presenter edit plan'),
    resolveExistingRegularWithinRoot(deliveryRoot, deliveryIndexFile, 'delivery index'),
    resolveNewOutputWithinRoot(deliveryRoot, outputFile, 'presenter composition output'),
    resolveNewOutputWithinRoot(deliveryRoot, receiptFile, 'presenter composition receipt'),
  ]);
  const sourcePath = sourceRecord.absolute;
  const planPath = planRecord.absolute;
  const indexPath = indexRecord.absolute;
  const [source, plan, deliveryIndex] = await Promise.all([
    readJson(sourcePath, 'presenter source contract'),
    readJson(planPath, 'presenter edit plan'),
    readJson(indexPath, 'delivery index'),
  ]);
  await Promise.all([
    assertSchema(source, 'presenter-source.schema.json', 'presenter source contract'),
    assertSchema(plan, 'presenter-edit-plan.schema.json', 'presenter edit plan'),
    assertSchema(deliveryIndex, 'delivery-index.schema.json', 'delivery index'),
  ]);
  const {runtimePlan, skillUsageBinding} = await verifyCompiledPlanBindings({
    productionRoot, sourceRecord, source, plan,
  });
  const presenter = await resolveExistingRegularWithinRoot(productionRoot, source.media.file, 'presenter media');
  if (await hashFile(presenter.absolute) !== source.media.sha256) throw new Error('presenter media hash changed after source registration');
  if (source.approval.approvedMediaSha256 !== source.media.sha256) {
    throw new Error('presenter approval is not bound to the registered media hash');
  }
  for (const [kind, binding] of Object.entries(source.inputIdentity)) {
    const input = await resolveExistingRegularWithinRoot(productionRoot, binding.file, `presenter ${kind}`);
    if (await hashFile(input.absolute) !== binding.sha256) throw new Error(`presenter ${kind} changed after source registration`);
  }
  const presenterFacts = await probeAudioVisual(presenter.absolute, {
    ffmpeg, ffprobe, runner, label: 'presenter media',
  });
  for (const key of ['durationMs', 'width', 'height', 'videoCodec', 'audioCodec', 'sampleRate', 'channels']) {
    if (presenterFacts[key] !== source.media[key]) throw new Error(`presenter media ${key} differs from its source contract`);
  }
  if (Math.abs(presenterFacts.fps - source.media.fps) > 1e-6) throw new Error('presenter media fps differs from its source contract');
  const shots = await loadVerifiedShots({
    productionRoot, deliveryRoot, deliveryIndex, planIdentity: runtimePlan.identity,
    skillUsageBinding, ffmpeg, ffprobe, runner,
  });
  const mix = validatePresenterEditPlan({ plan, shots, presenterDurationMs: presenterFacts.durationMs });
  const { width, height, fps } = plan.output;
  if (width % 2 !== 0 || height % 2 !== 0) throw new Error('presenter composition output width and height must be even');
  const args = ['-v', 'error', '-nostdin', '-i', presenter.absolute];
  const filters = [];
  const labels = [];
  let inputIndex = 1;
  for (const [index, segment] of plan.segments.entries()) {
    let localStart = segment.startMs;
    let localEnd = segment.endMs;
    let currentInput = 0;
    if (segment.kind === 'broll') {
      const shot = shots.get(segment.shotId);
      args.push('-i', shot.mediaPath);
      currentInput = inputIndex;
      inputIndex += 1;
      localStart -= shot.srtWindowMs.start;
      localEnd -= shot.srtWindowMs.start;
    }
    const label = `v${index}`;
    labels.push(`[${label}]`);
    filters.push(normalizedVideoFilter({ input: currentInput, startMs: localStart, endMs: localEnd, width, height, fps, output: label }));
  }
  filters.push(`${labels.join('')}concat=n=${labels.length}:v=1:a=0[vout]`);
  filters.push(`[0:a:0]atrim=start=0:end=${seconds(mix.durationMs)},asetpts=PTS-STARTPTS,aresample=48000[aout]`);
  const temporaryDirectory = await mkdtemp(path.join(path.dirname(output.absolute), '.presenter-compose-'));
  const temporaryOutput = path.join(temporaryDirectory, 'composition.mp4');
  const temporaryReceipt = path.join(temporaryDirectory, 'composition.receipt.json');
  args.push(
    '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-movflags', '+faststart', '-shortest', '-n', temporaryOutput,
  );
  let outputLinked = false;
  let receiptLinked = false;
  try {
    const composed = await runner({ executable: ffmpeg, args, cwd: path.dirname(output.absolute) });
    if (composed.code !== 0) throw commandFailure('presenter and B-roll composition', composed);
    await requireRegularFile(temporaryOutput, 'presenter and B-roll temporary composition');
    const facts = await probeAudioVisual(temporaryOutput, {
      ffmpeg, ffprobe, runner, label: 'presenter and B-roll composition',
    });
    const tolerance = 1000 / fps + 1;
    if (facts.videoCodec !== 'h264' || facts.width !== width || facts.height !== height
      || Math.abs(facts.fps - fps) > 1e-6 || Math.abs(facts.durationMs - mix.durationMs) > tolerance
      || facts.audioStreams !== 1) {
      throw new Error('presenter composition media facts differ from the edit plan');
    }
    await link(temporaryOutput, output.absolute);
    outputLinked = true;
    await writeVideoSkillUsage({
      productionRoot, videoFile: output.absolute, planIdentity: runtimePlan.identity,
      binding: skillUsageBinding,
    });
    const usedShotIds = [...new Set(plan.segments.filter(({ kind }) => kind === 'broll').map(({ shotId }) => shotId))];
    const receiptValue = {
      schemaVersion: '1.0.0',
      compositionScope: plan.compositionScope,
      authorizationUse: source.authorization.use,
      presenterKind: presenterKindOf(source),
      inputs: {
        presenterSourceSha256: await hashFile(sourcePath),
        deliveryIndexSha256: await hashFile(indexPath),
        editPlanSha256: await hashFile(planPath),
        shotMedia: usedShotIds.map((shotId) => ({ shotId, sha256: shots.get(shotId).mediaSha256 })),
      },
      mix: { ...mix, segments: plan.segments.length },
      output: {
        file: output.locator, sha256: await hashFile(output.absolute), durationMs: facts.durationMs,
        width: facts.width, height: facts.height, fps: facts.fps, codec: facts.videoCodec,
        audioStreams: facts.audioStreams, fullDecode: 'passed',
      },
    };
    await assertSchema(receiptValue, 'presenter-composition-receipt.schema.json', 'presenter composition receipt');
    await writeFile(temporaryReceipt, `${JSON.stringify(receiptValue, null, 2)}\n`, { flag: 'wx' });
    await link(temporaryReceipt, receipt.absolute);
    receiptLinked = true;
    await rm(temporaryDirectory, { recursive: true, force: true });
    return {
      status: 'presenter-broll-ready', output: output.absolute, receipt: receipt.absolute,
      mix, mediaFacts: { ...facts, codec: facts.videoCodec },
    };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    if (outputLinked) await rm(output.absolute, { force: true });
    if (outputLinked) await rm(`${output.absolute}.skill-usage.json`, { force: true });
    if (receiptLinked) await rm(receipt.absolute, { force: true });
    throw error;
  }
}

async function main() {
  const options = parseCliPairs(process.argv.slice(2));
  const result = await assemblePresenterBroll({
    productionRoot: options['production-root'], presenterSourceFile: options['presenter-source'],
    editPlanFile: options['edit-plan'], deliveryIndexFile: options['delivery-index'],
    deliveryRoot: options['delivery-root'], outputFile: options.output, receiptFile: options.receipt,
    ffmpeg: options.ffmpeg, ffprobe: options.ffprobe,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
