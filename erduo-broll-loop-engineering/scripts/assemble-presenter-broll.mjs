#!/usr/bin/env node

import {createHash} from 'node:crypto';
import { link, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { probeAudioVisual } from './create-presenter-source.mjs';
import { compilePresenterSegments, trimPresenterSegments } from './create-presenter-edit-plan.mjs';
import { canonicalJson, validateSchemaValue } from './runtime-schema-validator.mjs';
import {
  commandFailure, hashFile, probeAndDecode, readJson, requireRegularFile, runCommand,
} from './shot-media-lib.mjs';
import {
  parseCliPairs, presenterKindOf, resolveExistingDirectoryWithinRoot,
  resolveExistingRegularWithinRoot, resolveNewOutputWithinRoot,
} from './presenter-media-lib.mjs';
import { computeRecipeIdentity, computeRecipeTruthIdentity } from './validate-shot-recipes.mjs';
import { computeRuntimePlanIdentity } from './validate-runtime-plan.mjs';
import {verifyVideoSkillUsage, writeVideoSkillUsage} from './skill-usage.mjs';
import {isDirectExecution} from './direct-execution.mjs';
import {bindPresentationModeContext} from './presentation-mode.mjs';

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
  let splitMs = 0;
  for (const [index, segment] of plan.segments.entries()) {
    if (segment.startMs !== cursor) throw new Error(`segment ${index + 1} creates a timeline gap or overlap at ${cursor}ms`);
    if (!Number.isInteger(segment.endMs) || segment.endMs <= segment.startMs) throw new Error(`segment ${index + 1} has an invalid time window`);
    const duration = segment.endMs - segment.startMs;
    if (segment.kind === 'presenter') {
      if ('shotId' in segment) throw new Error(`presenter segment ${index + 1} must not declare shotId`);
      presenterMs += duration;
    } else if (segment.kind === 'broll' || segment.kind === 'split') {
      if (!segment.shotId) throw new Error(`B-roll segment ${index + 1} requires shotId`);
      const shot = shots.get(segment.shotId);
      if (!shot) throw new Error(`B-roll segment ${index + 1} references unknown shot ${segment.shotId}`);
      const window = shot.srtWindowMs;
      if (segment.startMs < window.start || segment.endMs > window.end) {
        throw new Error(`B-roll segment ${index + 1} is outside ${segment.shotId} SRT window`);
      }
      brollMs += duration;
      if (segment.kind === 'split') {
        presenterMs += duration;
        splitMs += duration;
      }
    } else {
      throw new Error(`segment ${index + 1} has unsupported kind`);
    }
    cursor = segment.endMs;
  }
  if (cursor > presenterDurationMs) throw new Error('edit plan extends beyond presenter media duration');
  return { durationMs: cursor, presenterDurationMs: presenterMs, brollDurationMs: brollMs, splitDurationMs: splitMs };
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
  const presentationContext = runtimePlan.sourceContext?.presentationMode ?? null;
  const currentPresentationContext = presentationContext
    ? await bindPresentationModeContext({
      productionRoot,
      presentationModeFile: path.join(productionRoot, presentationContext.locator),
      originalDesignFile: path.join(productionRoot, runtimePlan.sourceContext.originalDesign.locator),
      presenterSourceFile: sourceRecord.absolute,
      productionProfile: runtimePlan.productionProfile,
    }) : null;
  if (canonicalJson(presentationContext) !== canonicalJson(currentPresentationContext)) {
    throw new Error('bound presentation mode changed before presenter composition');
  }
  if (plan.schemaVersion === '3.0.0') {
    if (!presentationContext || plan.presentationMode !== presentationContext.mode
      || plan.presentationModeContract?.file !== presentationContext.locator
      || plan.presentationModeContract?.sha256 !== presentationContext.sha256
      || plan.presentationModeContract?.identity !== presentationContext.identity) {
      throw new Error('presenter edit plan presentation mode differs from its runtime binding');
    }
  }
  const expectedOutput = {
    width: presentationContext?.output.width ?? runtimePlan.productionProfile?.raster?.width,
    height: presentationContext?.output.height ?? runtimePlan.productionProfile?.raster?.height,
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
    if (['broll', 'split'].includes(segment.kind) && !boundShotIds.has(segment.shotId)) {
      throw new Error(`B-roll segment references unbound Recipe ${segment.shotId}`);
    }
  }
  const compiledSegments = compilePresenterSegments(
    boundRecipes, source.media.durationMs, presentationContext?.mode ?? 'original',
  );
  const expectedSegments = plan.window
    ? trimPresenterSegments(compiledSegments, plan.window.endMs)
    : compiledSegments;
  if (plan.window && (plan.compositionScope !== 'framework-demo' || plan.window.startMs !== 0)) {
    throw new Error('only framework-demo composition may declare a zero-based partial window');
  }
  if (canonicalJson(plan.segments) !== canonicalJson(expectedSegments)) {
    throw new Error('presenter edit plan segments differ from the bound Recipe presenter treatments');
  }
  const skillUsageBinding = runtimePlan.sourceContext?.skillUsage;
  if (!skillUsageBinding) throw new Error('presenter composition requires runtime-plan skill usage binding');
  return {runtimePlan, skillUsageBinding, boundRecipes};
}

function visualRecipeIdentity(recipe) {
  const projected = structuredClone(recipe);
  if (projected.creativeProposal) delete projected.creativeProposal.presenterTreatment;
  return createHash('sha256').update(canonicalJson(projected)).digest('hex');
}

function normalizeSha256Identity(value) {
  return typeof value === 'string' ? value.replace(/^sha256:/u, '') : value;
}

function seconds(ms) {
  return (ms / 1000).toFixed(6).replace(/0+$/u, '').replace(/\.$/u, '');
}

function normalizedVideoFilter({ input, startMs, endMs, width, height, fps, output }) {
  return `[${input}:v:0]trim=start=${seconds(startMs)}:end=${seconds(endMs)},setpts=PTS-STARTPTS,`
    + `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,`
    + `setsar=1,fps=${fps},format=yuv420p[${output}]`;
}

function evenFloor(value) {
  return Math.max(2, Math.floor(value / 2) * 2);
}

export function splitVideoFilters({
  presenterInput, brollInput, startMs, endMs, brollStartMs, brollEndMs,
  width, height, fps, output, index,
}) {
  const panelHeight = evenFloor(height * 0.9);
  const panelWidth = evenFloor(panelHeight * 9 / 16);
  const x = evenFloor(width * 0.06);
  const y = evenFloor((height - panelHeight) / 2);
  const halo = evenFloor(Math.max(12, height * 0.018));
  const base = `split-base-${index}`;
  const panel = `split-panel-${index}`;
  const haloLabel = `split-halo-${index}`;
  const foreground = `split-foreground-${index}`;
  const blended = `split-blended-${index}`;
  return [
    normalizedVideoFilter({
      input: presenterInput, startMs, endMs, width, height, fps, output: base,
    }),
    `[${brollInput}:v:0]trim=start=${seconds(brollStartMs)}:end=${seconds(brollEndMs)},setpts=PTS-STARTPTS,`
      + `scale=${panelWidth}:${panelHeight}:force_original_aspect_ratio=decrease,`
      + `pad=${panelWidth}:${panelHeight}:(ow-iw)/2:(oh-ih)/2:color=0x111315,setsar=1,fps=${fps},format=rgba,`
      + `split=2[${panel}][${foreground}]`,
    `[${panel}]pad=${panelWidth + halo * 2}:${panelHeight + halo * 2}:${halo}:${halo}:color=black@0,`
      + `gblur=sigma=${Math.max(6, Math.round(halo * 0.7))}[${haloLabel}]`,
    `[${base}][${haloLabel}]overlay=x=${x - halo}:y=${y - halo}:shortest=1[${blended}]`,
    `[${blended}][${foreground}]overlay=x=${x}:y=${y}:shortest=1,format=yuv420p[${output}]`,
  ];
}

export function portraitBrollInLandscapeFilters({
  input, startMs, endMs, width, height, fps, output, index,
}) {
  const foregroundWidth = evenFloor(height * 9 / 16);
  const source = `broll-source-${index}`;
  const background = `broll-background-${index}`;
  const foregroundInput = `broll-foreground-input-${index}`;
  const foreground = `broll-foreground-${index}`;
  return [
    `[${input}:v:0]trim=start=${seconds(startMs)}:end=${seconds(endMs)},setpts=PTS-STARTPTS,`
      + `setsar=1,fps=${fps},split=2[${source}][${foregroundInput}]`,
    `[${source}]scale=${width}:${height}:force_original_aspect_ratio=increase,`
      + `crop=${width}:${height},gblur=sigma=42,eq=brightness=-0.28:saturation=0.65,format=yuv420p[${background}]`,
    `[${foregroundInput}]scale=${foregroundWidth}:${height}:force_original_aspect_ratio=decrease,`
      + `pad=${foregroundWidth}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x111315,format=yuv420p[${foreground}]`,
    `[${background}][${foreground}]overlay=x=(W-w)/2:y=0:shortest=1,setsar=1,format=yuv420p[${output}]`,
  ];
}

export function assertLandscapeVariantCoverage({plan, landscapeShots}) {
  if (plan.presentationMode !== 'avatar-split' || plan.compositionScope === 'framework-demo') return;
  const missing = [...new Set(plan.segments
    .filter(({kind}) => kind === 'broll')
    .map(({shotId}) => shotId))]
    .filter((shotId) => !landscapeShots.has(shotId));
  if (missing.length) {
    throw new Error(`avatar-split canary/full-production requires landscape B-roll variants: ${missing.join(', ')}`);
  }
}

async function loadVerifiedShots({
  productionRoot, deliveryRoot, deliveryIndex, planIdentity, skillUsageBinding,
  verifySkillEvidence = true, ffmpeg, ffprobe, runner,
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
    if (verifySkillEvidence) {
      await verifyVideoSkillUsage({
        productionRoot, videoFile: mediaPath, planIdentity, binding: skillUsageBinding,
      });
    }
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
  brollProductionRoot = productionRoot,
  brollDeliveryRoot = deliveryRoot,
  brollRuntimePlanFile = path.join(brollProductionRoot, '01-runtime-plan', 'runtime-plan.json'),
  brollRecipesDirectory = path.join(brollProductionRoot, '01-director', 'shot-recipes'),
  landscapeProductionRoot = null,
  landscapeDeliveryRoot = null,
  landscapeDeliveryIndexFile = null,
  landscapeRuntimePlanFile = null,
  landscapeRecipesDirectory = null,
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
    resolveExistingRegularWithinRoot(brollDeliveryRoot, deliveryIndexFile, 'delivery index'),
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
  const {runtimePlan, skillUsageBinding, boundRecipes} = await verifyCompiledPlanBindings({
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
  const externalBroll = path.resolve(brollProductionRoot) !== path.resolve(productionRoot);
  let brollLineage = null;
  let shotPlanIdentity = runtimePlan.identity;
  let shotSkillUsageBinding = skillUsageBinding;
  const externalRecipeByShot = new Map();
  if (externalBroll) {
    if (plan.compositionScope !== 'framework-demo') {
      throw new Error('external legacy B-roll is allowed only for a non-publishable framework-demo');
    }
    const [brollPlanRecord, brollRecipeDirectory] = await Promise.all([
      resolveExistingRegularWithinRoot(brollProductionRoot, brollRuntimePlanFile, 'external B-roll runtime plan'),
      resolveExistingDirectoryWithinRoot(brollProductionRoot, brollRecipesDirectory, 'external B-roll Recipes'),
    ]);
    const brollPlan = await readJson(brollPlanRecord.absolute, 'external B-roll runtime plan');
    if (computeRuntimePlanIdentity(brollPlan) !== brollPlan.identity) {
      throw new Error('external B-roll runtime plan identity differs from its contents');
    }
    if (brollPlan.sourceContext?.originalSrt?.sha256 !== runtimePlan.sourceContext?.originalSrt?.sha256
      || brollPlan.sourceContext?.originalDesign?.sha256 !== runtimePlan.sourceContext?.originalDesign?.sha256
      || brollPlan.productionProfile?.identity !== runtimePlan.productionProfile?.identity) {
      throw new Error('external B-roll lineage differs from the current SRT, DesignMD, or production profile');
    }
    const currentRecipes = new Map(boundRecipes.map((recipe) => [recipe.shotId, recipe]));
    const usedShotIds = [...new Set(plan.segments
      .filter(({kind}) => ['broll', 'split'].includes(kind))
      .map(({shotId}) => shotId))];
    const visualBindings = [];
    for (const shotId of usedShotIds) {
      const currentRecipe = currentRecipes.get(shotId);
      const priorRecipeRecord = await resolveExistingRegularWithinRoot(
        brollRecipeDirectory.absolute, path.join(brollRecipeDirectory.absolute, `${shotId}.json`),
        `${shotId} external B-roll Recipe`,
      );
      const priorRecipe = await readJson(priorRecipeRecord.absolute, `${shotId} external B-roll Recipe`);
      if (!currentRecipe || computeRecipeTruthIdentity(priorRecipe) !== computeRecipeTruthIdentity(currentRecipe)
        || visualRecipeIdentity(priorRecipe) !== visualRecipeIdentity(currentRecipe)) {
        throw new Error(`${shotId} external B-roll Recipe differs beyond presenterTreatment`);
      }
      externalRecipeByShot.set(shotId, priorRecipe);
      visualBindings.push({shotId, visualRecipeIdentity: visualRecipeIdentity(currentRecipe)});
    }
    shotPlanIdentity = brollPlan.identity;
    shotSkillUsageBinding = null;
    brollLineage = {
      mode: 'external-legacy-framework-demo', publishable: false,
      runtimePlanSha256: await hashFile(brollPlanRecord.absolute), runtimePlanIdentity: brollPlan.identity,
      skillEvidence: brollPlan.sourceContext?.skillUsage ? 'historical-binding-not-current' : 'missing-legacy',
      visualBindings,
    };
  }
  const shots = await loadVerifiedShots({
    productionRoot: brollProductionRoot, deliveryRoot: brollDeliveryRoot, deliveryIndex,
    planIdentity: shotPlanIdentity, skillUsageBinding: shotSkillUsageBinding,
    verifySkillEvidence: !externalBroll, ffmpeg, ffprobe, runner,
  });
  for (const [shotId, priorRecipe] of externalRecipeByShot) {
    if (normalizeSha256Identity(shots.get(shotId)?.contract.recipeIdentity)
      !== normalizeSha256Identity(computeRecipeIdentity(priorRecipe))) {
      throw new Error(`${shotId} external media contract is not bound to its Recipe`);
    }
  }
  let landscapeShots = new Map();
  let landscapeVariantLineage = null;
  if (landscapeDeliveryIndexFile) {
    if (plan.presentationMode !== 'avatar-split') {
      throw new Error('landscape B-roll variants require avatar-split presentation mode');
    }
    const variantProductionRoot = path.resolve(landscapeProductionRoot ?? productionRoot);
    const variantDeliveryRoot = path.resolve(landscapeDeliveryRoot ?? path.join(variantProductionRoot, '05-delivery'));
    const variantRuntimePlanFile = landscapeRuntimePlanFile
      ?? path.join(variantProductionRoot, '01-runtime-plan', 'runtime-plan.json');
    const variantRecipesDirectory = landscapeRecipesDirectory
      ?? path.join(variantProductionRoot, '01-director', 'shot-recipes');
    const [variantIndexRecord, variantPlanRecord, variantRecipeDirectory] = await Promise.all([
      resolveExistingRegularWithinRoot(variantDeliveryRoot, landscapeDeliveryIndexFile, 'landscape B-roll delivery index'),
      resolveExistingRegularWithinRoot(variantProductionRoot, variantRuntimePlanFile, 'landscape B-roll runtime plan'),
      resolveExistingDirectoryWithinRoot(variantProductionRoot, variantRecipesDirectory, 'landscape B-roll Recipes'),
    ]);
    const [variantIndex, variantPlan] = await Promise.all([
      readJson(variantIndexRecord.absolute, 'landscape B-roll delivery index'),
      readJson(variantPlanRecord.absolute, 'landscape B-roll runtime plan'),
    ]);
    await assertSchema(variantIndex, 'delivery-index.schema.json', 'landscape B-roll delivery index');
    if (computeRuntimePlanIdentity(variantPlan) !== variantPlan.identity) {
      throw new Error('landscape B-roll runtime plan identity differs from its contents');
    }
    const variantFps = variantPlan.productionProfile?.fps?.numerator
      / variantPlan.productionProfile?.fps?.denominator;
    if (variantPlan.sourceContext?.originalSrt?.sha256 !== runtimePlan.sourceContext?.originalSrt?.sha256
      || variantPlan.sourceContext?.originalDesign?.sha256 !== runtimePlan.sourceContext?.originalDesign?.sha256
      || variantPlan.productionProfile?.raster?.width !== plan.output.width
      || variantPlan.productionProfile?.raster?.height !== plan.output.height
      || Math.abs(variantFps - plan.output.fps) > 1e-6) {
      throw new Error('landscape B-roll lineage differs from the current SRT, DesignMD, or landscape output profile');
    }
    const requiredLandscapeShotIds = [...new Set(plan.segments
      .filter(({kind}) => kind === 'broll').map(({shotId}) => shotId))];
    const currentRecipes = new Map(boundRecipes.map((recipe) => [recipe.shotId, recipe]));
    const variantRecipes = new Map();
    for (const shotId of requiredLandscapeShotIds) {
      const record = await resolveExistingRegularWithinRoot(
        variantRecipeDirectory.absolute, path.join(variantRecipeDirectory.absolute, `${shotId}.json`),
        `${shotId} landscape B-roll Recipe`,
      );
      const recipe = await readJson(record.absolute, `${shotId} landscape B-roll Recipe`);
      const current = currentRecipes.get(shotId);
      if (!current || computeRecipeTruthIdentity(recipe) !== computeRecipeTruthIdentity(current)
        || visualRecipeIdentity(recipe) !== visualRecipeIdentity(current)) {
        throw new Error(`${shotId} landscape B-roll Recipe differs beyond presenterTreatment`);
      }
      variantRecipes.set(shotId, recipe);
    }
    const variantSkillUsageBinding = variantPlan.sourceContext?.skillUsage;
    if (!variantSkillUsageBinding) throw new Error('landscape B-roll runtime plan requires current Skill evidence');
    landscapeShots = await loadVerifiedShots({
      productionRoot: variantProductionRoot, deliveryRoot: variantDeliveryRoot,
      deliveryIndex: variantIndex, planIdentity: variantPlan.identity,
      skillUsageBinding: variantSkillUsageBinding, verifySkillEvidence: true,
      ffmpeg, ffprobe, runner,
    });
    for (const shotId of requiredLandscapeShotIds) {
      const shot = landscapeShots.get(shotId);
      if (!shot) throw new Error(`${shotId} requires a delivered landscape B-roll variant`);
      if (normalizeSha256Identity(shot.contract.recipeIdentity)
        !== normalizeSha256Identity(computeRecipeIdentity(variantRecipes.get(shotId)))) {
        throw new Error(`${shotId} landscape media contract is not bound to its Recipe`);
      }
    }
    landscapeVariantLineage = {
      runtimePlanSha256: await hashFile(variantPlanRecord.absolute),
      runtimePlanIdentity: variantPlan.identity,
      skillEvidence: 'current',
      shotIds: requiredLandscapeShotIds,
    };
  }
  const effectiveShots = new Map(shots);
  for (const [shotId, shot] of landscapeShots) effectiveShots.set(shotId, shot);
  assertLandscapeVariantCoverage({plan, landscapeShots});
  const mix = validatePresenterEditPlan({ plan, shots: effectiveShots, presenterDurationMs: presenterFacts.durationMs });
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
    if (segment.kind === 'broll' || segment.kind === 'split') {
      const shot = segment.kind === 'broll'
        ? (landscapeShots.get(segment.shotId) ?? shots.get(segment.shotId))
        : shots.get(segment.shotId);
      args.push('-i', shot.mediaPath);
      currentInput = inputIndex;
      inputIndex += 1;
      localStart -= shot.srtWindowMs.start;
      localEnd -= shot.srtWindowMs.start;
    }
    const label = `v${index}`;
    labels.push(`[${label}]`);
    if (segment.kind === 'split') {
      filters.push(...splitVideoFilters({
        presenterInput: 0, brollInput: currentInput,
        startMs: segment.startMs, endMs: segment.endMs,
        brollStartMs: localStart, brollEndMs: localEnd,
        width, height, fps, output: label, index,
      }));
    } else if (segment.kind === 'broll' && plan.presentationMode === 'avatar-split'
      && width > height && !landscapeShots.has(segment.shotId)) {
      filters.push(...portraitBrollInLandscapeFilters({
        input: currentInput, startMs: localStart, endMs: localEnd,
        width, height, fps, output: label, index,
      }));
    } else {
      filters.push(normalizedVideoFilter({ input: currentInput, startMs: localStart, endMs: localEnd, width, height, fps, output: label }));
    }
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
    const usedShotRecords = [];
    const usedShotKeys = new Set();
    for (const segment of plan.segments.filter(({kind}) => ['broll', 'split'].includes(kind))) {
      const variant = segment.kind === 'broll' && landscapeShots.has(segment.shotId) ? 'landscape' : 'portrait';
      const key = `${segment.shotId}:${variant}`;
      if (usedShotKeys.has(key)) continue;
      usedShotKeys.add(key);
      const shot = variant === 'landscape' ? landscapeShots.get(segment.shotId) : shots.get(segment.shotId);
      usedShotRecords.push({shotId: segment.shotId, variant, sha256: shot.mediaSha256});
    }
    const receiptValue = {
      schemaVersion: '1.0.0',
      compositionScope: plan.compositionScope,
      authorizationUse: source.authorization.use,
      presenterKind: presenterKindOf(source),
      ...(brollLineage ? {brollLineage: {
        ...brollLineage,
        ...(landscapeVariantLineage ? {landscapeVariants: landscapeVariantLineage} : {}),
      }} : {}),
      inputs: {
        presenterSourceSha256: await hashFile(sourcePath),
        deliveryIndexSha256: await hashFile(indexPath),
        editPlanSha256: await hashFile(planPath),
        shotMedia: usedShotRecords,
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
      status: brollLineage ? 'presenter-broll-framework-demo-ready' : 'presenter-broll-ready',
      output: output.absolute, receipt: receipt.absolute,
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
    brollProductionRoot: options['broll-production-root'],
    brollDeliveryRoot: options['broll-delivery-root'],
    brollRuntimePlanFile: options['broll-runtime-plan'],
    brollRecipesDirectory: options['broll-recipes'],
    landscapeProductionRoot: options['landscape-production-root'],
    landscapeDeliveryRoot: options['landscape-delivery-root'],
    landscapeDeliveryIndexFile: options['landscape-delivery-index'],
    landscapeRuntimePlanFile: options['landscape-runtime-plan'],
    landscapeRecipesDirectory: options['landscape-recipes'],
    ffmpeg: options.ffmpeg, ffprobe: options.ffprobe,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
