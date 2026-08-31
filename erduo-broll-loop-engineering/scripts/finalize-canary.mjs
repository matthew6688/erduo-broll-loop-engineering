#!/usr/bin/env node

import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {isDirectExecution} from './direct-execution.mjs';
import {readJson, runCommand} from './shot-media-lib.mjs';
import {tryFinalizeCanaryTechnicalGate} from './render-assigned-shots.mjs';
import {runTimedProductionStage} from './record-production-event.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotSchemaFile = path.join(skillRoot, 'references', 'runtime', 'shot-media.schema.json');

export async function finalizeCanary({
  planFile,
  productionRoot,
  recipesDirectory,
  deliveryRoot = path.join(productionRoot, '05-delivery'),
  ffmpeg = 'ffmpeg',
  ffprobe = 'ffprobe',
  runner = runCommand,
  verifyPlanInputs,
}) {
  const [plan, shotSchema] = await Promise.all([
    readJson(path.resolve(planFile), 'runtime plan'),
    readJson(shotSchemaFile, 'shot media schema'),
  ]);
  const gate = await tryFinalizeCanaryTechnicalGate({
    plan,
    planFile: path.resolve(planFile),
    productionRoot: path.resolve(productionRoot),
    deliveryRoot: path.resolve(deliveryRoot),
    recipesDirectory: path.resolve(recipesDirectory),
    shotSchema,
    ffmpeg,
    ffprobe,
    runner,
    verifyPlanInputs,
  });
  if (!gate) throw new Error('canary is not ready to finalize: media contracts or view receipts are missing');
  return gate;
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
  for (const name of ['plan', 'production-root', 'recipes']) {
    if (!options[name]) throw new Error(`--${name} is required`);
  }
  const gate = await runTimedProductionStage({
    eventsFile: path.join(path.resolve(options['production-root']), 'production-events.ndjson'),
    stage: 'delivery', phase: 'canary-finalize',
  }, () => finalizeCanary({
    planFile: options.plan,
    productionRoot: options['production-root'],
    recipesDirectory: options.recipes,
    ffmpeg: options.ffmpeg ?? 'ffmpeg',
    ffprobe: options.ffprobe ?? 'ffprobe',
  }));
  process.stdout.write(`${JSON.stringify({status: gate.status, identity: gate.identity, preview: gate.canaryPreview.locator})}\n`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
