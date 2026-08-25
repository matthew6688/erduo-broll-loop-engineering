import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {auditOnscreenText} from '../erduo-broll-loop-engineering/scripts/audit-onscreen-text.mjs';
import {auditShotMotion} from '../erduo-broll-loop-engineering/scripts/audit-shot-motion.mjs';

async function root(t) {
  const value = await mkdtemp(path.join(os.tmpdir(), 'rendered-evidence-gates-'));
  t.after(() => rm(value, {recursive: true, force: true}));
  return value;
}

test('onscreen-text preflight rejects production scaffolding before any video or shot contract exists', async (t) => {
  const productionRoot = await root(t);
  const sourceRoot = path.join(productionRoot, '03-build', 'U001', 'source');
  const recipes = path.join(productionRoot, '01-director', 'shot-recipes');
  const assignments = path.join(productionRoot, '01-runtime-plan', 'assignments');
  await Promise.all([
    mkdir(path.join(sourceRoot, 'compositions'), {recursive: true}),
    mkdir(recipes, {recursive: true}), mkdir(assignments, {recursive: true}),
    mkdir(path.join(productionRoot, '00-inputs'), {recursive: true}),
  ]);
  const plan = {identity: '9'.repeat(64), shots: [{shotId: 's01'}]};
  await Promise.all([
    writeFile(path.join(productionRoot, '01-runtime-plan', 'runtime-plan.json'), `${JSON.stringify(plan)}\n`),
    writeFile(path.join(assignments, 'U001.json'), `${JSON.stringify({shotIds: ['s01'], sourceRoot: '03-build/U001/source'})}\n`),
    writeFile(path.join(recipes, 's01.json'), `${JSON.stringify({
      shotId: 's01', creativeProposal: {objects: ['已授权'], visibleText: [{text: '已授权', source: 'object', objectRef: '已授权'}]},
    })}\n`),
    writeFile(path.join(productionRoot, '00-inputs', 'original.srt'), '1\n00:00:00,000 --> 00:00:01,000\n已授权\n'),
    writeFile(path.join(sourceRoot, 'compositions', 's01.html'), '<body><div>LAYER 01 / DEBUG</div></body>\n'),
  ]);
  const args = {
    planFile: path.join(productionRoot, '01-runtime-plan', 'runtime-plan.json'),
    recipesDirectory: recipes, productionRoot,
    originalSrtFile: path.join(productionRoot, '00-inputs', 'original.srt'),
    shotIds: ['s01'],
  };
  const failed = await auditOnscreenText(args);
  assert.equal(failed.status, 'signals');
  assert.match(failed.shots[0].findings[0].signal, /production-scaffolding/u);
  await writeFile(path.join(sourceRoot, 'compositions', 's01.html'), '<body><div>已授权</div></body>\n');
  assert.equal((await auditOnscreenText(args)).status, 'passed');
});

test('shot-motion gate accepts staged development with only the declared final hold and rejects a frozen shot', async (t) => {
  if (spawnSync('ffmpeg', ['-version'], {stdio: 'ignore'}).status !== 0) t.skip('ffmpeg unavailable');
  const productionRoot = await root(t);
  const shots = path.join(productionRoot, '05-delivery', 'shots');
  const recipes = path.join(productionRoot, '01-director', 'shot-recipes');
  await Promise.all([mkdir(shots, {recursive: true}), mkdir(recipes, {recursive: true})]);
  const planFile = path.join(productionRoot, 'runtime-plan.json');
  const motionMapFile = path.join(productionRoot, 'motion-map.json');
  await Promise.all([
    writeFile(planFile, `${JSON.stringify({
      identity: '8'.repeat(64), productionProfile: {raster: {width: 320, height: 180}},
    })}\n`),
    writeFile(motionMapFile, `${JSON.stringify({shots: [{shotId: 's01', rhythm: 'progressive', settleMs: 500}]})}\n`),
    writeFile(path.join(recipes, 's01.json'), `${JSON.stringify({
      shotId: 's01', truth: {srtWindowMs: {startMs: 0, endMs: 2000}, readableHold: {startMs: 1500, endMs: 2000}},
      creativeProposal: {keyStates: ['opening', 'action', 'result']},
    })}\n`),
  ]);
  const video = path.join(shots, '001-s01.mp4');
  let rendered = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=320x180:rate=30:duration=1.5', '-vf', 'tpad=stop_mode=clone:stop_duration=0.5',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', video]);
  assert.equal(rendered.status, 0, rendered.stderr?.toString());
  const writeContract = async () => writeFile(path.join(shots, '001-s01.shot-media.json'), `${JSON.stringify({
    shotId: 's01', media: {path: 'shots/001-s01.mp4', fps: 30,
      sha256: createHash('sha256').update(await readFile(video)).digest('hex')},
  })}\n`);
  await writeContract();
  const args = {planFile, recipesDirectory: recipes, productionRoot, motionMapFile, shotIds: ['s01']};
  assert.equal((await auditShotMotion(args)).status, 'passed');

  rendered = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i',
    'color=black:size=320x180:rate=30:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', video]);
  assert.equal(rendered.status, 0, rendered.stderr?.toString());
  await writeContract();
  const frozen = await auditShotMotion(args);
  assert.equal(frozen.status, 'signals');
  assert.ok(frozen.shots[0].findings.some(({signal}) => ['tail-still-exceeds-declared-hold', 'action-window-underdeveloped'].includes(signal)));
});
