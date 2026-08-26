#!/usr/bin/env node

import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSchemaValue } from './runtime-schema-validator.mjs';
import { hashFile, readJson } from './shot-media-lib.mjs';
import {
  parseCliPairs, presenterKindOf, resolveExistingDirectoryWithinRoot, resolveExistingRegularWithinRoot,
  resolveNewOutputWithinRoot,
} from './presenter-media-lib.mjs';
import { validateRuntimePlan } from './validate-runtime-plan.mjs';
import {
  computeRecipeIdentity, computeRecipeTruthIdentity, validateRecipeDirectory,
} from './validate-shot-recipes.mjs';
import {isDirectExecution} from './direct-execution.mjs';

const schemas = path.resolve(import.meta.dirname, '..', 'references', 'runtime');

function runtimePlanInputs(productionRoot, recipesDirectory, plan) {
  const director = path.join(productionRoot, '01-director');
  const source = plan.sourceContext ?? {};
  return {
    productionRoot,
    narrativeEnvelopeFile: path.join(director, 'narrative-envelope.json'),
    visualSystemFile: path.join(director, 'visual-system.json'),
    representativeScenesFile: path.join(director, 'representative-scenes.json'),
    motionMapFile: path.join(director, 'motion-map.json'),
    recipesDirectory,
    ...(source.originalSrt?.locator
      ? { originalSrtFile: path.join(productionRoot, source.originalSrt.locator) } : {}),
    ...(source.originalDesign?.locator
      ? { originalDesignFile: path.join(productionRoot, source.originalDesign.locator) } : {}),
    ...(source.presenterSource?.locator
      ? { presenterSourceFile: path.join(productionRoot, source.presenterSource.locator) } : {}),
  };
}

function pushSegment(segments, segment) {
  const previous = segments.at(-1);
  if (previous?.kind === segment.kind && previous.endMs === segment.startMs
    && (segment.kind === 'presenter' || previous.shotId === segment.shotId)) {
    previous.endMs = segment.endMs;
    return;
  }
  segments.push(segment);
}

function compileRecipeSegments(recipe) {
  const treatment = recipe.creativeProposal?.presenterTreatment;
  if (!treatment) throw new Error(`${recipe.shotId}: presenterTreatment is required for digital-presenter compilation`);
  const { startMs, endMs } = recipe.truth.srtWindowMs;
  if (treatment.mode === 'presenter') {
    if (treatment.brollWindows !== undefined) throw new Error(`${recipe.shotId}: presenter mode must not declare brollWindows`);
    return [{ kind: 'presenter', startMs, endMs }];
  }
  if (treatment.mode === 'broll') {
    if (treatment.brollWindows !== undefined) throw new Error(`${recipe.shotId}: broll mode must not declare brollWindows`);
    return [{ kind: 'broll', shotId: recipe.shotId, startMs, endMs }];
  }
  const windows = treatment.brollWindows;
  if (treatment.mode !== 'mixed' || !Array.isArray(windows) || windows.length === 0) {
    throw new Error(`${recipe.shotId}: mixed mode requires one or more brollWindows`);
  }
  const result = [];
  let cursor = startMs;
  for (const [index, window] of windows.entries()) {
    if (!Number.isInteger(window.startMs) || !Number.isInteger(window.endMs)
      || window.startMs < cursor || window.endMs <= window.startMs || window.endMs > endMs) {
      throw new Error(`${recipe.shotId}: brollWindows[${index}] must be ordered, non-overlapping, and inside its SRT window`);
    }
    if (window.startMs > cursor) result.push({ kind: 'presenter', startMs: cursor, endMs: window.startMs });
    result.push({ kind: 'broll', shotId: recipe.shotId, startMs: window.startMs, endMs: window.endMs });
    cursor = window.endMs;
  }
  if (cursor < endMs) result.push({ kind: 'presenter', startMs: cursor, endMs });
  return result;
}

export function compilePresenterSegments(recipes, presenterDurationMs) {
  const ordered = [...recipes].toSorted(
    (left, right) => left.truth.srtWindowMs.startMs - right.truth.srtWindowMs.startMs,
  );
  const segments = [];
  let cursor = 0;
  for (const recipe of ordered) {
    const window = recipe.truth.srtWindowMs;
    if (window.startMs < cursor) throw new Error(`${recipe.shotId}: Recipe SRT window overlaps the preceding Recipe`);
    if (window.startMs > cursor) pushSegment(segments, { kind: 'presenter', startMs: cursor, endMs: window.startMs });
    for (const segment of compileRecipeSegments(recipe)) pushSegment(segments, segment);
    cursor = window.endMs;
  }
  if (cursor > presenterDurationMs) throw new Error('Recipe timeline extends beyond presenter media duration');
  if (cursor < presenterDurationMs) pushSegment(segments, { kind: 'presenter', startMs: cursor, endMs: presenterDurationMs });
  return segments;
}

async function assertSchema(value, name, label) {
  const schema = await readJson(path.join(schemas, name), `${label} schema`);
  const errors = validateSchemaValue(value, schema, schema);
  if (errors.length) throw new Error(`${label} failed schema validation:\n- ${errors.join('\n- ')}`);
}

export async function createPresenterEditPlan({
  productionRoot,
  runtimePlanFile,
  recipesDirectory = path.join(productionRoot, '01-director', 'shot-recipes'),
  presenterSourceFile,
  outputFile = path.join(productionRoot, '01-runtime-plan', 'presenter-edit-plan.json'),
  compositionScope = 'canary',
  verifyRuntimePlan,
}) {
  for (const [label, value] of Object.entries({ productionRoot, runtimePlanFile, recipesDirectory, presenterSourceFile, outputFile })) {
    if (!value) throw new Error(`${label} is required`);
  }
  const [runtimeRecord, presenterRecord, recipeDirectoryRecord, output] = await Promise.all([
    resolveExistingRegularWithinRoot(productionRoot, runtimePlanFile, 'runtime plan'),
    resolveExistingRegularWithinRoot(productionRoot, presenterSourceFile, 'presenter source contract'),
    resolveExistingDirectoryWithinRoot(productionRoot, recipesDirectory, 'Recipe directory'),
    resolveNewOutputWithinRoot(productionRoot, outputFile, 'presenter edit plan'),
  ]);
  const recipeDirectory = recipeDirectoryRecord.absolute;
  const [runtimePlan, presenterSource] = await Promise.all([
    readJson(runtimeRecord.absolute, 'runtime plan'),
    readJson(presenterRecord.absolute, 'presenter source contract'),
  ]);
  await Promise.all([
    assertSchema(presenterSource, 'presenter-source.schema.json', 'presenter source contract'),
    validateRecipeDirectory(recipeDirectory),
  ]);
  const verifier = verifyRuntimePlan ?? ((plan) => validateRuntimePlan(
    plan, {
      ...runtimePlanInputs(path.resolve(productionRoot), recipeDirectory, plan),
      allowCreativeRevisions: true,
    },
  ));
  await verifier(runtimePlan);
  if (runtimePlan.schemaVersion !== '4.0.0') throw new Error('digital-presenter compilation requires runtime plan v4');
  if (runtimePlan.sourceContext?.originalSrt?.sha256 !== presenterSource.inputIdentity.srt.sha256) {
    throw new Error('runtime plan original SRT differs from the presenter source SRT');
  }
  const plannedPresenter = runtimePlan.sourceContext?.presenterSource;
  const presenterSourceSha256 = await hashFile(presenterRecord.absolute);
  if (!plannedPresenter || plannedPresenter.locator !== presenterRecord.locator
    || plannedPresenter.sha256 !== presenterSourceSha256
    || plannedPresenter.mediaSha256 !== presenterSource.media.sha256
    || plannedPresenter.durationMs !== presenterSource.media.durationMs
    || plannedPresenter.authorizationUse !== presenterSource.authorization.use
    || plannedPresenter.approvalScope !== presenterSource.approval.scope) {
    throw new Error('runtime plan is not bound to the current presenter source contract');
  }
  if (presenterKindOf(plannedPresenter) !== presenterKindOf(presenterSource)) {
    throw new Error('runtime plan presenter kind differs from the current presenter source contract');
  }
  if (!['framework-demo', 'canary', 'full-production'].includes(compositionScope)) {
    throw new Error('compositionScope must be framework-demo, canary, or full-production');
  }
  if (compositionScope === 'framework-demo'
    && (presenterSource.authorization.use !== 'internal-framework-demo'
      || presenterSource.approval.scope !== 'framework-demo'
      || presenterSource.approval.lipSync !== 'not-evaluated')) {
    throw new Error('framework-demo composition requires isolated demo authorization, demo approval, and unevaluated lip sync');
  }
  if (compositionScope === 'canary'
    && (presenterSource.authorization.use !== 'internal-canary'
      || presenterSource.approval.scope !== 'canary'
      || presenterSource.approval.lipSync !== 'approved')) {
    throw new Error('canary composition requires internal-canary authorization and approved canary lip sync');
  }
  if (compositionScope === 'full-production'
    && (presenterSource.authorization.use !== 'publishing'
      || presenterSource.approval.scope !== 'full-production')) {
    throw new Error('full-production composition requires publishing authorization and full-production approval');
  }
  const entries = (await readdir(recipeDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const loaded = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(recipeDirectory, entry.name);
    const recipe = await readJson(absolute, `${entry.name} Recipe`);
    return { absolute, recipe };
  }));
  const recipes = [];
  for (const { absolute, recipe } of loaded) {
    recipes.push({
      shotId: recipe.shotId,
      file: `${recipeDirectoryRecord.locator}/${path.basename(absolute)}`,
      recipeIdentity: computeRecipeIdentity(recipe),
      truthIdentity: computeRecipeTruthIdentity(recipe),
    });
  }
  const durationMs = presenterSource.media.durationMs;
  const segments = compilePresenterSegments(loaded.map(({ recipe }) => recipe), durationMs);
  const fps = runtimePlan.productionProfile.fps.numerator / runtimePlan.productionProfile.fps.denominator;
  const plan = {
    schemaVersion: '2.0.0',
    authoredBy: 'compiled-from-recipe-creative-proposals',
    compositionScope,
    runtimePlan: {
      file: runtimeRecord.locator, sha256: await hashFile(runtimeRecord.absolute), identity: runtimePlan.identity,
    },
    presenterSource: {
      file: presenterRecord.locator, sha256: presenterSourceSha256, mediaSha256: presenterSource.media.sha256,
    },
    recipes,
    output: {
      width: runtimePlan.productionProfile.raster.width,
      height: runtimePlan.productionProfile.raster.height,
      fps,
    },
    segments,
  };
  await assertSchema(plan, 'presenter-edit-plan.schema.json', 'presenter edit plan');
  await writeFile(output.absolute, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
  return { status: 'presenter-edit-plan-ready', output: output.absolute, plan };
}

async function main() {
  const options = parseCliPairs(process.argv.slice(2));
  const result = await createPresenterEditPlan({
    productionRoot: options['production-root'], runtimePlanFile: options.plan,
    recipesDirectory: options.recipes, presenterSourceFile: options['presenter-source'],
    outputFile: options.output, compositionScope: options.scope,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
