#!/usr/bin/env node

import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {isDirectExecution} from './direct-execution.mjs';
import {canonicalJson, validateSchemaValue} from './runtime-schema-validator.mjs';
import {hashFile, readJson, requireRegularFile} from './shot-media-lib.mjs';
import {computeRecipeIdentity, computeRecipeTruthIdentity} from './validate-shot-recipes.mjs';
import {runTimedProductionStage} from './record-production-event.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const receiptSchemaFile = path.join(skillRoot, 'references', 'runtime', 'chapter-creative-receipt.schema.json');

function withinRoot(root, locator, label) {
  if (path.isAbsolute(locator)) throw new Error(`${label} must be relative to the production root`);
  const file = path.resolve(root, locator);
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label} escapes the production root`);
  return file;
}

async function closeCreativeHandoff({root, assignment, decision, viewedArtifact, creativeProposalChanges}) {
  const receiptLocator = assignment?.output?.viewReceipt;
  const handoffLocator = assignment?.output?.handoff;
  if (typeof receiptLocator !== 'string' || typeof handoffLocator !== 'string') {
    throw new Error('assignment must declare output.viewReceipt and output.handoff');
  }
  const handoffFile = withinRoot(root, handoffLocator, 'creative handoff');
  const handoff = [
    `# ${assignment.assignmentId} creative handoff`,
    '',
    `status: ${decision}`,
    `viewed: ${viewedArtifact.kind}`,
    `view receipt: ${receiptLocator}`,
    `creative proposal changes: ${creativeProposalChanges.length}`,
    '',
  ].join('\n');
  try {
    await writeFile(handoffFile, handoff, {flag: 'wx'});
    return {status: 'created', file: handoffFile};
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(handoffFile, 'utf8');
    if (!existing.includes(receiptLocator) && !existing.includes(path.basename(receiptLocator))) {
      throw new Error('creative handoff already exists but does not reference its view receipt');
    }
    return {status: 'preserved', file: handoffFile};
  }
}

export async function createViewReceipt({
  productionRoot,
  planFile,
  assignmentFile,
  recipesDirectory,
  decision,
  viewedArtifact,
  creativeProposalChanges = [],
}) {
  const root = path.resolve(productionRoot);
  const [plan, assignment, schema] = await Promise.all([
    readJson(path.resolve(planFile), 'runtime plan'),
    readJson(path.resolve(assignmentFile), 'assignment'),
    readJson(receiptSchemaFile, 'view receipt schema'),
  ]);
  if (assignment.planIdentity !== plan.identity) throw new Error('assignment does not bind the runtime plan');
  if (!['accepted', 'revised'].includes(decision)) throw new Error('view decision must be accepted or revised');
  if (!viewedArtifact || !['six-frame-sheets', 'chapter-preview', 'both'].includes(viewedArtifact.kind)) {
    throw new Error('viewed artifact must name six-frame-sheets, chapter-preview, or both');
  }
  const viewedFile = withinRoot(root, viewedArtifact.locator, 'viewed artifact');
  await requireRegularFile(viewedFile, 'viewed artifact');
  const shotIds = [...assignment.shotIds];
  const recipeBindings = await Promise.all(shotIds.map(async (shotId) => {
    const recipe = await readJson(path.join(path.resolve(recipesDirectory), `${shotId}.json`), `${shotId} Recipe`);
    if (recipe.shotId !== shotId) throw new Error(`${shotId} Recipe binding is invalid`);
    return {
      shotId,
      recipeIdentity: computeRecipeIdentity(recipe),
      truthIdentity: computeRecipeTruthIdentity(recipe),
    };
  }));
  const receipt = {
    schemaVersion: '1.0.0',
    planIdentity: plan.identity,
    assignmentId: assignment.assignmentId,
    unitId: assignment.unitId ?? assignment.assignmentId,
    shotIds,
    recipeBindings,
    decision,
    viewedArtifact,
    viewedSha256: await hashFile(viewedFile),
    creativeProposalChanges,
  };
  const errors = validateSchemaValue(receipt, schema, schema);
  if (errors.length > 0) throw new Error(`view receipt failed schema validation:\n- ${errors.join('\n- ')}`);
  const receiptFile = withinRoot(root, assignment.output.viewReceipt, 'view receipt');
  const body = `${JSON.stringify(receipt, null, 2)}\n`;
  let status;
  try {
    await writeFile(receiptFile, body, {flag: 'wx'});
    status = 'created';
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(receiptFile, 'utf8');
    if (canonicalJson(JSON.parse(existing)) !== canonicalJson(receipt)) {
      throw new Error('view receipt already exists with different content; use a new production root or assignment revision');
    }
    status = 'cached';
  }
  const handoff = await closeCreativeHandoff({
    root, assignment, decision, viewedArtifact, creativeProposalChanges,
  });
  return {status, file: receiptFile, receipt, handoff};
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || !value) throw new Error(`invalid argument ${name ?? ''}`);
    options[name.slice(2)] = value;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const required = ['production-root', 'plan', 'assignment', 'recipes', 'decision', 'viewed-kind', 'viewed-artifact'];
  for (const name of required) if (!options[name]) throw new Error(`--${name} is required`);
  const changes = options.changes
    ? JSON.parse(await readFile(path.resolve(options.changes), 'utf8'))
    : [];
  const assignmentId = path.basename(options.assignment, path.extname(options.assignment));
  const result = await runTimedProductionStage({
    eventsFile: path.join(path.resolve(options['production-root']), 'production-events.ndjson'),
    stage: 'builder', phase: 'view-receipt', unitId: assignmentId,
  }, () => createViewReceipt({
    productionRoot: options['production-root'],
    planFile: options.plan,
    assignmentFile: options.assignment,
    recipesDirectory: options.recipes,
    decision: options.decision,
    viewedArtifact: {kind: options['viewed-kind'], locator: options['viewed-artifact']},
    creativeProposalChanges: changes,
  }));
  process.stdout.write(`${JSON.stringify({
    status: result.status, file: result.file, handoff: result.handoff,
  })}\n`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
