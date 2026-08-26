import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  beginRenderAttempt,
  finishRenderAttempt,
  MAX_RENDER_ATTEMPTS,
} from '../erduo-broll-loop-engineering/scripts/render-attempt-budget.mjs';
import {runHyperframesVisualPreflight} from '../erduo-broll-loop-engineering/scripts/render-assigned-shots.mjs';

test('render attempt budget permits two renders and blocks an unbounded third retry', async (t) => {
  const productionRoot = await mkdtemp(path.join(os.tmpdir(), 'render-budget-'));
  t.after(() => rm(productionRoot, {recursive: true, force: true}));
  const assignment = {
    assignmentId: 'U001', output: {workDirectory: '03-build/U001'},
  };
  for (let sequence = 1; sequence <= MAX_RENDER_ATTEMPTS; sequence += 1) {
    const started = await beginRenderAttempt({
      productionRoot, assignment, planIdentity: 'plan-1', sourceIdentity: `source-${sequence}`,
    });
    assert.equal(started.attempt.sequence, sequence);
    await finishRenderAttempt({...started, status: 'failed', detailCode: 'motion-audit'});
  }
  await assert.rejects(
    beginRenderAttempt({productionRoot, assignment, planIdentity: 'plan-1', sourceIdentity: 'source-3'}),
    /exhausted its 2-attempt render budget.*Recipe or runtime plan/iu,
  );
  const records = (await readFile(
    path.join(productionRoot, '03-build/U001/checks/render-attempts.ndjson'), 'utf8',
  )).trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(({status}) => status), ['started', 'failed', 'started', 'failed']);
});

test('preflight failures consume no render-attempt budget', async (t) => {
  const productionRoot = await mkdtemp(path.join(os.tmpdir(), 'render-budget-'));
  t.after(() => rm(productionRoot, {recursive: true, force: true}));
  const assignment = {assignmentId: 'L001', output: {workDirectory: '04-visual-lock/hyperframes'}};
  const first = await beginRenderAttempt({
    productionRoot, assignment, planIdentity: 'plan-1', sourceIdentity: 'source-after-preflight',
  });
  assert.equal(first.attempt.sequence, 1);
});

test('HyperFrames visual check runs before render budget and writes a bound receipt', async (t) => {
  const productionRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-preflight-'));
  t.after(() => rm(productionRoot, {recursive: true, force: true}));
  const sourceRoot = path.join(productionRoot, 'source');
  await mkdir(path.join(sourceRoot, 'compositions'), {recursive: true});
  await writeFile(path.join(sourceRoot, 'compositions', 'scene-01.html'), '<main></main>');
  const assignment = {
    assignmentId: 'L001', runtime: 'hyperframes',
    output: {workDirectory: '04-visual-lock/hyperframes'},
  };
  const calls = [];
  const result = await runHyperframesVisualPreflight({
    assignment, plan: {identity: 'plan-1'}, sourceRoot,
    sourceIdentity: 'sha256:source', productionRoot, hyperframes: '/runtime/hyperframes',
    compositionIds: ['scene-01'],
    runner: async (invocation) => {
      calls.push(invocation);
      return {code: 0, stdout: JSON.stringify({status: 'passed', issues: []}), stderr: ''};
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0], 'check');
  assert.equal(path.basename(calls[0].args[1]), 'source');
  assert.ok(calls[0].args.includes('--at-transitions'));
  assert.ok(calls[0].args.includes('--frame-check'));
  const receipt = JSON.parse(await readFile(result.file, 'utf8'));
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.planIdentity, 'plan-1');
  await assert.rejects(
    readFile(path.join(productionRoot, assignment.output.workDirectory, 'checks', 'render-attempts.ndjson')),
    /ENOENT/u,
  );
});

test('HyperFrames visual check failure does not consume a render attempt', async (t) => {
  const productionRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-preflight-'));
  t.after(() => rm(productionRoot, {recursive: true, force: true}));
  const sourceRoot = path.join(productionRoot, 'source');
  await mkdir(path.join(sourceRoot, 'compositions'), {recursive: true});
  await writeFile(path.join(sourceRoot, 'compositions', 'scene-01.html'), '<main></main>');
  const assignment = {
    assignmentId: 'U001', runtime: 'hyperframes',
    output: {workDirectory: '03-build/U001'},
  };
  await assert.rejects(
    runHyperframesVisualPreflight({
      assignment, plan: {identity: 'plan-1'}, sourceRoot,
      sourceIdentity: 'sha256:source', productionRoot, hyperframes: '/runtime/hyperframes',
      compositionIds: ['scene-01'],
      runner: async () => ({code: 1, stdout: '', stderr: 'overlap detected'}),
    }),
    /visual preflight failed: overlap detected/iu,
  );
  await assert.rejects(
    readFile(path.join(productionRoot, assignment.output.workDirectory, 'checks', 'render-attempts.ndjson')),
    /ENOENT/u,
  );
});
