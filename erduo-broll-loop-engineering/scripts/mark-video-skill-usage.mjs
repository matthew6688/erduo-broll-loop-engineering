#!/usr/bin/env node

import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {parseCliPairs, resolveExistingRegularWithinRoot} from './presenter-media-lib.mjs';
import {readJson} from './shot-media-lib.mjs';
import {writeVideoSkillUsage} from './skill-usage.mjs';
import {computeRuntimePlanIdentity} from './validate-runtime-plan.mjs';
import {isDirectExecution} from './direct-execution.mjs';

export async function markVideoSkillUsage({productionRoot, planFile, videoFile, outputFile}) {
  if (!productionRoot || !planFile || !videoFile) {
    throw new Error('mark video skill usage requires productionRoot, planFile, and videoFile');
  }
  const root = path.resolve(productionRoot);
  const [planRecord, videoRecord] = await Promise.all([
    resolveExistingRegularWithinRoot(root, planFile, 'runtime plan'),
    resolveExistingRegularWithinRoot(root, videoFile, 'video'),
  ]);
  const plan = await readJson(planRecord.absolute, 'runtime plan');
  if (!plan.identity || computeRuntimePlanIdentity(plan) !== plan.identity) {
    throw new Error('runtime plan identity is missing or stale');
  }
  if (!plan.sourceContext?.skillUsage) throw new Error('runtime plan has no skill usage binding');
  return writeVideoSkillUsage({
    productionRoot: root, videoFile: videoRecord.absolute, planIdentity: plan.identity,
    binding: plan.sourceContext.skillUsage, outputFile,
  });
}

async function main() {
  const options = parseCliPairs(process.argv.slice(2));
  const result = await markVideoSkillUsage({
    productionRoot: options['production-root'], planFile: options.plan,
    videoFile: options.video, outputFile: options.output,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => {process.stderr.write(`${error.message}\n`); process.exitCode = 1;});
}
