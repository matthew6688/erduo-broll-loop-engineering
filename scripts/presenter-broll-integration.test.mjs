import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assemblePresenterBroll,
  validatePresenterEditPlan,
} from '../erduo-broll-loop-engineering/scripts/assemble-presenter-broll.mjs';
import { createPresenterSource } from '../erduo-broll-loop-engineering/scripts/create-presenter-source.mjs';
import { resolveExistingRegularWithinRoot } from '../erduo-broll-loop-engineering/scripts/presenter-media-lib.mjs';

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

function plan(segments) {
  return {
    schemaVersion: '1.0.0',
    output: { width: 640, height: 360, fps: 30 },
    segments,
  };
}

test('presenter edit plan requires contiguous coverage and B-roll inside its SRT window', () => {
  const shots = new Map([
    ['S01', { shotId: 'S01', srtWindowMs: { start: 1000, end: 3000 } }],
  ]);
  assert.throws(() => validatePresenterEditPlan({
    plan: plan([
      { kind: 'presenter', startMs: 0, endMs: 900 },
      { kind: 'broll', shotId: 'S01', startMs: 1000, endMs: 3000 },
    ]),
    shots,
    presenterDurationMs: 3000,
  }), /gap or overlap/u);
  assert.throws(() => validatePresenterEditPlan({
    plan: plan([
      { kind: 'presenter', startMs: 0, endMs: 1000 },
      { kind: 'broll', shotId: 'S01', startMs: 1000, endMs: 3100 },
    ]),
    shots,
    presenterDurationMs: 3100,
  }), /outside.*SRT window/u);
  const valid = validatePresenterEditPlan({
    plan: plan([
      { kind: 'presenter', startMs: 0, endMs: 1000 },
      { kind: 'broll', shotId: 'S01', startMs: 1000, endMs: 3000 },
    ]),
    shots,
    presenterDurationMs: 3000,
  });
  assert.equal(valid.durationMs, 3000);
  assert.equal(valid.brollDurationMs, 2000);
  assert.equal(valid.presenterDurationMs, 1000);
});

function probePayload({ durationMs, frameCount, fps, audioStreams }) {
  return JSON.stringify({
    streams: [
      {
        codec_type: 'video', codec_name: 'h264', width: 640, height: 360,
        avg_frame_rate: `${fps}/1`, nb_read_frames: String(frameCount), start_time: '0',
      },
      ...Array.from({ length: audioStreams }, () => ({
        codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2,
      })),
    ],
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(durationMs / 1000), start_time: '0' },
  });
}

function controlledRunner(calls) {
  return async ({ executable, args }) => {
    calls.push({ executable, args: [...args] });
    const target = path.resolve(args.at(-1));
    if (executable === 'ffprobe') {
      const facts = target.includes('001-S01')
        ? { durationMs: 2000, frameCount: 60, fps: 30, audioStreams: 0 }
        : target.includes('presenter.mp4')
          ? { durationMs: 4000, frameCount: 100, fps: 25, audioStreams: 1 }
          : { durationMs: 4000, frameCount: 120, fps: 30, audioStreams: 1 };
      return { code: 0, stdout: probePayload(facts), stderr: '' };
    }
    if (executable === 'ffmpeg' && args.includes('null')) return { code: 0, stdout: '', stderr: '' };
    if (executable === 'ffmpeg') {
      const graph = args[args.indexOf('-filter_complex') + 1];
      assert.match(graph, /concat=n=3:v=1:a=0\[vout\]/u);
      assert.match(graph, /\[0:a:0\]atrim=start=0:end=4/u);
      assert.ok(args.includes('[vout]') && args.includes('[aout]'));
      assert.ok(args.includes('-n'));
      await writeFile(target, 'CONTROLLED-PRESENTER-BROLL');
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: `unexpected command ${executable}` };
  };
}

test('compositor preserves one presenter audio stream while switching to validated silent B-roll', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'presenter-broll-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const productionRoot = path.join(base, 'production');
  const deliveryRoot = path.join(productionRoot, '05-delivery');
  const presenterDirectory = path.join(productionRoot, '00-inputs', 'presenter');
  const shotsDirectory = path.join(deliveryRoot, 'shots');
  await Promise.all([
    mkdir(presenterDirectory, { recursive: true }),
    mkdir(shotsDirectory, { recursive: true }),
  ]);
  const presenterFile = path.join(presenterDirectory, 'presenter.mp4');
  const shotFile = path.join(shotsDirectory, '001-S01.mp4');
  const srtFile = path.join(presenterDirectory, 'source.srt');
  const portraitFile = path.join(presenterDirectory, 'portrait.png');
  const narrationFile = path.join(presenterDirectory, 'narration.wav');
  await Promise.all([
    writeFile(presenterFile, 'PRESENTER'), writeFile(shotFile, 'SHOT'),
    writeFile(srtFile, 'SRT'), writeFile(portraitFile, 'PORTRAIT'), writeFile(narrationFile, 'NARRATION'),
  ]);
  const calls = [];
  const runner = controlledRunner(calls);
  const sourceFile = path.join(presenterDirectory, 'presenter-source.json');
  await createPresenterSource({
    productionRoot, inputFile: presenterFile, outputFile: sourceFile, provider: 'heygen',
    srtFile, portraitFile, narrationFile,
    alignment: { method: 'local-whisper', status: 'confirmed' },
    authorization: { likeness: 'confirmed', voice: 'confirmed', use: 'internal-canary' },
    approval: { scope: 'canary', approvedBy: 'user', identity: 'approved', voice: 'approved', lipSync: 'approved' },
    runner,
  });
  const shotHash = sha(await readFile(shotFile));
  const contract = {
    schemaVersion: '1.0.0', order: 1, shotId: 'S01', unitId: 'U001',
    srtWindowMs: { start: 1000, end: 3000 },
    localTimeline: { startFrame: 0, frameCount: 60 }, backend: 'hyperframes',
    renderTarget: { id: 'S01', mode: 'direct-runtime-render' },
    sourceIdentity: `sha256:${sha('source')}`, recipeIdentity: `sha256:${sha('recipe')}`,
    profileIdentity: `sha256:${sha('profile')}`,
    media: { path: 'shots/001-S01.mp4', durationMs: 2000, width: 640, height: 360, fps: 30, codec: 'h264', sha256: shotHash, fullDecode: 'passed' },
    semanticCheck: {
      sourceMedia: 'shots/001-S01.mp4', contactSheet: 'checks/001-S01.semantic-check.png', sha256: sha('sheet'),
      samples: ['opening', 'preparation', 'action-a', 'action-b', 'result', 'settle-tail']
        .map((role, frame) => ({ role, localTimeMs: frame * 300, frame: frame * 9 })),
    },
  };
  await writeFile(path.join(shotsDirectory, '001-S01.shot-media.json'), `${JSON.stringify(contract)}\n`);
  const deliveryIndexFile = path.join(deliveryRoot, 'delivery-index.json');
  await writeFile(deliveryIndexFile, `${JSON.stringify({
    schemaVersion: '1.0.0',
    shots: [{ order: 1, shotId: 'S01', file: 'shots/001-S01.mp4', contract: 'shots/001-S01.shot-media.json', srtWindowMs: { start: 1000, end: 3000 }, previousShotId: null, nextShotId: null, seamType: 'cut' }],
  })}\n`);
  const editPlanFile = path.join(productionRoot, 'presenter-edit-plan.json');
  await writeFile(editPlanFile, `${JSON.stringify(plan([
    { kind: 'presenter', startMs: 0, endMs: 1000 },
    { kind: 'broll', shotId: 'S01', startMs: 1000, endMs: 3000 },
    { kind: 'presenter', startMs: 3000, endMs: 4000 },
  ]))}\n`);
  const outputFile = path.join(deliveryRoot, 'presenter-broll-master.mp4');
  const receiptFile = path.join(deliveryRoot, 'presenter-broll-master.receipt.json');
  await writeFile(srtFile, 'CHANGED-SRT');
  await assert.rejects(assemblePresenterBroll({
    productionRoot, deliveryRoot, presenterSourceFile: sourceFile,
    deliveryIndexFile, editPlanFile, outputFile, receiptFile, runner,
  }), /presenter srt changed/u);
  await writeFile(srtFile, 'SRT');
  const result = await assemblePresenterBroll({
    productionRoot, deliveryRoot, presenterSourceFile: sourceFile,
    deliveryIndexFile, editPlanFile, outputFile, receiptFile,
    runner,
  });
  assert.equal(result.status, 'presenter-broll-ready');
  assert.equal(result.mediaFacts.audioStreams, 1);
  assert.equal(result.mediaFacts.width, 640);
  assert.equal(result.mediaFacts.height, 360);
  assert.ok(Math.abs(result.mediaFacts.fps - 30) < 1e-6);
  assert.ok(Math.abs(result.mediaFacts.durationMs - 4000) <= 35);
  const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
  assert.equal(receipt.mix.brollDurationMs, 2000);
  assert.equal(receipt.mix.presenterDurationMs, 2000);
  assert.equal(receipt.output.fullDecode, 'passed');
  const source = JSON.parse(await readFile(sourceFile, 'utf8'));
  assert.equal(source.inputIdentity.srt.sha256, sha('SRT'));
  assert.equal(source.approval.lipSync, 'approved');
  assert.equal(source.approval.approvedMediaSha256, source.media.sha256);
});

test('presenter paths reject an intermediate symlink that escapes the production root', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'presenter-path-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const productionRoot = path.join(base, 'production');
  const outside = path.join(base, 'outside');
  await Promise.all([mkdir(productionRoot), mkdir(outside)]);
  await writeFile(path.join(outside, 'presenter.mp4'), 'outside');
  await symlink(outside, path.join(productionRoot, 'linked-inputs'));
  await assert.rejects(
    resolveExistingRegularWithinRoot(productionRoot, 'linked-inputs/presenter.mp4', 'presenter input'),
    /inside its declared root/u,
  );
});
