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
import {commandFailure} from '../erduo-broll-loop-engineering/scripts/shot-media-lib.mjs';

test('command failures retain structured stdout when stderr only contains runtime diagnostics', () => {
  const error = commandFailure('HyperFrames visual preflight', {
    code: 1,
    signal: null,
    stdout: JSON.stringify({ok: false, layout: {errorCount: 1, findings: [{code: 'text_occluded'}]}}),
    stderr: '[hyperframes] browserGpuMode probe → hardware',
  });
  assert.match(error.message, /text_occluded/u);
  assert.match(error.message, /browserGpuMode probe/u);
});

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

test('HyperFrames visual preflight aggregates every failing composition in one pass', async (t) => {
  const productionRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-preflight-'));
  t.after(() => rm(productionRoot, {recursive: true, force: true}));
  const sourceRoot = path.join(productionRoot, 'source');
  await mkdir(path.join(sourceRoot, 'compositions'), {recursive: true});
  await Promise.all([
    writeFile(path.join(sourceRoot, 'compositions', 'scene-01.html'), '<main></main>'),
    writeFile(path.join(sourceRoot, 'compositions', 'scene-02.html'), '<main></main>'),
  ]);
  const calls = [];
  await assert.rejects(
    runHyperframesVisualPreflight({
      assignment: {
        assignmentId: 'U001', runtime: 'hyperframes',
        output: {workDirectory: '03-build/U001'},
      },
      plan: {identity: 'plan-1'}, sourceRoot,
      sourceIdentity: 'sha256:source', productionRoot, hyperframes: '/runtime/hyperframes',
      compositionIds: ['scene-01', 'scene-02'],
      runner: async () => {
        const scene = `scene-0${calls.length + 1}`;
        calls.push(scene);
        return {
          code: 1,
          stdout: JSON.stringify({ok: false, layout: {findings: [{code: `${scene}-overflow`}]}}),
          stderr: '[hyperframes] browserGpuMode probe → hardware',
        };
      },
    }),
    (error) => {
      assert.match(error.message, /scene-01-overflow/u);
      assert.match(error.message, /scene-02-overflow/u);
      return true;
    },
  );
  assert.deepEqual(calls, ['scene-01', 'scene-02']);
});

test('HyperFrames visual preflight refuses an unchanged repeat of the same failed source', async (t) => {
  const productionRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-preflight-'));
  t.after(() => rm(productionRoot, {recursive: true, force: true}));
  const sourceRoot = path.join(productionRoot, 'source');
  await mkdir(path.join(sourceRoot, 'compositions'), {recursive: true});
  await writeFile(path.join(sourceRoot, 'compositions', 'scene-01.html'), '<main></main>');
  const assignment = {
    assignmentId: 'U001', runtime: 'hyperframes',
    output: {workDirectory: '03-build/U001'},
  };
  let calls = 0;
  const invoke = () => runHyperframesVisualPreflight({
    assignment, plan: {identity: 'plan-1'}, sourceRoot,
    sourceIdentity: `sha256:${'a'.repeat(64)}`, productionRoot,
    hyperframes: '/runtime/hyperframes', compositionIds: ['scene-01'],
    runner: async () => {
      calls += 1;
      return {code: 1, stdout: '{"ok":false}', stderr: 'layout failed'};
    },
  });
  await assert.rejects(invoke(), /layout failed/u);
  await assert.rejects(invoke(), /unchanged source.*must change before retry/iu);
  assert.equal(calls, 1);
});

test('HyperFrames visual preflight checks compositions concurrently with a bounded isolated pool', async (t) => {
  const productionRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-preflight-'));
  t.after(() => rm(productionRoot, {recursive: true, force: true}));
  const sourceRoot = path.join(productionRoot, 'source');
  const compositionIds = ['scene-01', 'scene-02', 'scene-03', 'scene-04'];
  await mkdir(path.join(sourceRoot, 'compositions'), {recursive: true});
  await Promise.all(compositionIds.map((id) => (
    writeFile(path.join(sourceRoot, 'compositions', `${id}.html`), `<main>${id}</main>`)
  )));
  let active = 0;
  let maximumActive = 0;
  const result = await runHyperframesVisualPreflight({
    assignment: {
      assignmentId: 'U001', runtime: 'hyperframes',
      output: {workDirectory: '03-build/U001'},
    },
    plan: {identity: 'plan-1'}, sourceRoot,
    sourceIdentity: 'sha256:source', productionRoot, hyperframes: '/runtime/hyperframes',
    compositionIds, maxConcurrency: 2,
    runner: async ({cwd}) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const source = await readFile(path.join(cwd, 'index.html'), 'utf8');
      active -= 1;
      return {code: 0, stdout: JSON.stringify({source}), stderr: ''};
    },
  });
  assert.equal(maximumActive, 2);
  assert.deepEqual(result.receipt.reports.map(({compositionId}) => compositionId), compositionIds);
  assert.deepEqual(
    result.receipt.reports.map(({report}) => report.source),
    compositionIds.map((id) => `<main>${id}</main>`),
  );
  assert.equal(result.receipt.command.maxConcurrency, 2);
});

test('only classified transient preflight failures may retry unchanged source', async (t) => {
  const productionRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-preflight-'));
  t.after(() => rm(productionRoot, {recursive: true, force: true}));
  const sourceRoot = path.join(productionRoot, 'source');
  await mkdir(path.join(sourceRoot, 'compositions'), {recursive: true});
  await writeFile(path.join(sourceRoot, 'compositions', 'scene-01.html'), '<main></main>');
  const assignment = {
    assignmentId: 'U001', runtime: 'hyperframes',
    output: {workDirectory: '03-build/U001'},
  };
  let calls = 0;
  const invoke = () => runHyperframesVisualPreflight({
    assignment, plan: {identity: 'plan-1'}, sourceRoot,
    sourceIdentity: `sha256:${'b'.repeat(64)}`, productionRoot,
    hyperframes: '/runtime/hyperframes', compositionIds: ['scene-01'],
    runner: async () => {
      calls += 1;
      if (calls === 1) return {code: 124, signal: null, stdout: '', stderr: 'command timed out'};
      return {code: 0, signal: null, stdout: '{"status":"passed"}', stderr: ''};
    },
  });
  await assert.rejects(invoke(), /transient.*timeout.*retry is permitted/iu);
  const passed = await invoke();
  assert.equal(passed.receipt.status, 'passed');
  assert.equal(calls, 2);
  const transientDirectory = path.join(
    productionRoot, assignment.output.workDirectory, 'checks', 'preflight-transient',
  );
  const transientFiles = await import('node:fs/promises').then(({readdir}) => readdir(transientDirectory));
  assert.equal(transientFiles.length, 1);
  const transient = JSON.parse(await readFile(path.join(transientDirectory, transientFiles[0]), 'utf8'));
  assert.equal(transient.retryPolicy, 'unchanged-source-retry-permitted');
  assert.equal(transient.failures[0].detailCode, 'timeout');
});

test('unknown preflight exit codes remain deterministic and block unchanged retries', async (t) => {
  const productionRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-preflight-'));
  t.after(() => rm(productionRoot, {recursive: true, force: true}));
  const sourceRoot = path.join(productionRoot, 'source');
  await mkdir(path.join(sourceRoot, 'compositions'), {recursive: true});
  await writeFile(path.join(sourceRoot, 'compositions', 'scene-01.html'), '<main></main>');
  const assignment = {
    assignmentId: 'U001', runtime: 'hyperframes', output: {workDirectory: '03-build/U001'},
  };
  let calls = 0;
  const invoke = () => runHyperframesVisualPreflight({
    assignment, plan: {identity: 'plan-1'}, sourceRoot,
    sourceIdentity: `sha256:${'c'.repeat(64)}`, productionRoot,
    hyperframes: '/runtime/hyperframes', compositionIds: ['scene-01'],
    runner: async () => {
      calls += 1;
      return {code: 75, signal: null, stdout: '', stderr: 'unclassified failure'};
    },
  });
  await assert.rejects(invoke(), /unclassified failure/u);
  await assert.rejects(invoke(), /unchanged source.*must change before retry/iu);
  assert.equal(calls, 1);
});
