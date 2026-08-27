import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {preparePerformanceSandbox} from '../erduo-broll-loop-engineering/scripts/prepare-performance-sandbox.mjs';

const identity = (value) => createHash('sha256').update(value).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'erduo-performance-sandbox-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const source = path.join(root, 'source');
  const target = path.join(root, 'trial');
  await mkdir(path.join(source, '00-inputs'), {recursive: true});
  await mkdir(path.join(source, '01-director', 'shot-recipes'), {recursive: true});
  await mkdir(path.join(source, '01-runtime-plan', 'assignments'), {recursive: true});
  await mkdir(path.join(source, '02-assets', 'fonts'), {recursive: true});
  await mkdir(path.join(source, '04-visual-lock', 'hyperframes', 'shared-source'), {recursive: true});
  await mkdir(path.join(source, '03-build', 'U001', 'source'), {recursive: true});
  const runtime = path.join(root, 'runtime.js');
  await writeFile(runtime, 'export default true;\n');
  await writeFile(path.join(source, '00-inputs', 'original.srt'), '1\n00:00:00,000 --> 00:00:05,000\n测试\n');
  await writeFile(path.join(source, '00-inputs', 'original-design.md'), '# design\n');
  await writeFile(path.join(source, '00-inputs', 'skill-usage.json'), '{}\n');
  await writeFile(path.join(source, '00-inputs', 'production-governance.json'), '{}\n');
  await writeFile(path.join(source, 'production-profile.json'), '{}\n');
  await writeFile(path.join(source, 'production-governance.lock.json'), '{}\n');
  await writeFile(path.join(source, '02-assets', 'fonts', 'font.txt'), 'font\n');
  await writeFile(path.join(source, '04-visual-lock', 'hyperframes', 'shared-source', 'index.html'), '<main/>\n');
  await writeFile(path.join(source, '03-build', 'U001', 'source', 'index.html'), '<main/>\n');
  await writeFile(path.join(source, '00-inputs', 'visual-plan-approval.json'), '{"approval":true}\n');
  await mkdir(path.join(source, '05-delivery'), {recursive: true});
  await writeFile(path.join(source, '05-delivery', 'old.mp4'), 'old media\n');
  await writeFile(path.join(source, 'production-events.ndjson'), '{}\n');

  // Runtime validation is intentionally exercised in integration fixtures; this
  // compact unit fixture patches a minimal valid plan after the copy boundary is tested.
  return {root, source, target, runtime};
}

async function writeAssignments({source, runtime, shots = ['S1', 'S2', 'S3', 'S4', 'S5']}) {
  const runtimeSha = identity(await readFile(runtime));
  const planIdentity = identity('plan');
  const assignment = (assignmentId, role, sourceRoot, shotIds) => ({
    assignmentId, role, planIdentity, runtime: 'hyperframes', sourceRoot,
    canaryPhase: {mode: 'canary-first', shotIds},
    runtimeExecutable: {locator: runtime, sha256: runtimeSha, verified: true},
  });
  await writeFile(path.join(source, '01-runtime-plan', 'assignments', 'L001.json'), JSON.stringify(
    assignment('L001', 'lead', '04-visual-lock/hyperframes/shared-source', shots.slice(0, 3)),
  ));
  await writeFile(path.join(source, '01-runtime-plan', 'assignments', 'U001.json'), JSON.stringify(
    assignment('U001', 'builder', '03-build/U001/source', shots.slice(3)),
  ));
  return {planIdentity, shots};
}

test('performance sandbox refuses an incomplete plan before copying approval or delivery evidence', async (t) => {
  const {source, target} = await fixture(t);
  await writeFile(path.join(source, '01-runtime-plan', 'runtime-plan.json'), JSON.stringify({
    schemaVersion: '4.0.0', status: 'planned', identity: identity('plan'), canaryGate: {shotIds: ['S1', 'S2', 'S3', 'S4', 'S5']},
  }));
  await assert.rejects(preparePerformanceSandbox({sourceRoot: source, targetRoot: target}), /assignment|runtime plan/iu);
  await assert.rejects(readFile(path.join(target, '00-inputs', 'visual-plan-approval.json')), /ENOENT/u);
  await assert.rejects(readFile(path.join(target, '05-delivery', 'old.mp4')), /ENOENT/u);
});

test('performance sandbox rejects source symlinks and never leaves a partial target', async (t) => {
  const {root, source, target, runtime} = await fixture(t);
  const {planIdentity, shots} = await writeAssignments({source, runtime});
  await writeFile(path.join(source, '01-runtime-plan', 'runtime-plan.json'), JSON.stringify({
    schemaVersion: '4.0.0', status: 'planned', identity: planIdentity, canaryGate: {shotIds: shots},
  }));
  await symlink(path.join(root, 'runtime.js'), path.join(source, '03-build', 'U001', 'source', 'escape.js'));
  await assert.rejects(preparePerformanceSandbox({sourceRoot: source, targetRoot: target}), /symlink/u);
  await assert.rejects(readFile(path.join(target, 'performance-sandbox.json')), /ENOENT/u);
});

test('performance sandbox copies only frozen inputs and sources, then emits isolated commands', async (t) => {
  const {source, target, runtime} = await fixture(t);
  const {planIdentity, shots} = await writeAssignments({source, runtime});
  await writeFile(path.join(source, '01-runtime-plan', 'runtime-plan.json'), JSON.stringify({
    schemaVersion: '4.0.0', status: 'planned', identity: planIdentity,
    canaryGate: {shotIds: shots}, sourceContext: {},
  }));
  const calls = [];
  const result = await preparePerformanceSandbox({
    sourceRoot: source, targetRoot: target,
    validatePlan: async (plan, files) => { calls.push({plan, files}); return {status: 'valid'}; },
  });
  assert.equal(result.status, 'prepared');
  assert.equal(calls.length, 1);
  assert.equal(result.manifest.commands.length, 2);
  assert.deepEqual(result.manifest.commands.map(({assignmentId}) => assignmentId), ['L001', 'U001']);
  assert.deepEqual(new Set(result.manifest.commands.flatMap(({shotIds}) => shotIds)), new Set(shots));
  for (const command of result.manifest.commands) {
    assert.equal(command.executable, process.execPath);
    assert.ok(command.args.includes(result.targetRoot));
    assert.ok(command.args.every((argument) => !String(argument).startsWith(source)));
  }
  await assert.rejects(readFile(path.join(target, '00-inputs', 'visual-plan-approval.json')), /ENOENT/u);
  await assert.rejects(readFile(path.join(target, '05-delivery', 'old.mp4')), /ENOENT/u);
  await assert.rejects(readFile(path.join(target, 'production-events.ndjson')), /ENOENT/u);
  assert.equal(JSON.parse(await readFile(path.join(target, 'performance-sandbox.json'), 'utf8')).status, 'prepared');
  await assert.rejects(
    preparePerformanceSandbox({sourceRoot: source, targetRoot: target, validatePlan: async () => ({status: 'valid'})}),
    /already exists/u,
  );
});
