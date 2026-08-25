import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  beginRenderAttempt,
  finishRenderAttempt,
  MAX_RENDER_ATTEMPTS,
} from '../erduo-broll-loop-engineering/scripts/render-attempt-budget.mjs';

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
