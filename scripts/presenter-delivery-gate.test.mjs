import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {hashFile} from '../erduo-broll-loop-engineering/scripts/shot-media-lib.mjs';
import {
  registerSkillUsage, verifySkillUsage, writeVideoSkillUsage,
} from '../erduo-broll-loop-engineering/scripts/skill-usage.mjs';
import {computeRuntimePlanIdentity} from '../erduo-broll-loop-engineering/scripts/validate-runtime-plan.mjs';
import {
  parseSrtCues, parseVolumeDetect, verifyPresenterDelivery,
} from '../erduo-broll-loop-engineering/scripts/verify-presenter-delivery.mjs';

test('SRT parser rejects overlaps and volume parser reads ffmpeg output', () => {
  assert.equal(parseSrtCues('1\n00:00:00,000 --> 00:00:01,000\n你好\n').length, 1);
  assert.throws(() => parseSrtCues(
    '1\n00:00:00,000 --> 00:00:01,000\nA\n\n2\n00:00:00,900 --> 00:00:02,000\nB\n',
  ), /overlaps/u);
  assert.deepEqual(parseVolumeDetect('mean_volume: -18.1 dB\nmax_volume: -1.1 dB'), {
    meanVolumeDb: -18.1, maxVolumeDb: -1.1,
  });
});

test('final delivery gate reports missing required inputs before resolving defaults', async () => {
  await assert.rejects(verifyPresenterDelivery({}), /requires productionRoot/u);
});

async function deliveryFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'presenter-delivery-gate-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const inputRoot = path.join(root, '00-inputs');
  const planRoot = path.join(root, '01-runtime-plan');
  const deliveryRoot = path.join(root, '05-delivery');
  await Promise.all([
    mkdir(inputRoot, {recursive: true}), mkdir(planRoot, {recursive: true}), mkdir(deliveryRoot, {recursive: true}),
  ]);
  const skillFile = path.join(root, 'authority', 'SKILL.md');
  await mkdir(path.dirname(skillFile), {recursive: true});
  await writeFile(skillFile, '---\nname: erduo-broll-loop-engineering\n---\n# Test authority\n');
  await registerSkillUsage({productionRoot: root, skillFile, skillName: 'erduo-broll-loop-engineering'});
  const skillUsage = await verifySkillUsage({productionRoot: root});
  const srt = '1\n00:00:00,000 --> 00:00:01,900\n稳定输出\n';
  const originalSrt = path.join(inputRoot, 'original.srt');
  const subtitle = path.join(deliveryRoot, 'final.srt');
  const baseMedia = path.join(deliveryRoot, 'presenter-broll-master.mp4');
  const finalMedia = path.join(deliveryRoot, 'final.mp4');
  await Promise.all([
    writeFile(originalSrt, srt), writeFile(subtitle, srt),
    writeFile(baseMedia, 'BASE-MEDIA'), writeFile(finalMedia, 'FINAL-MEDIA'),
  ]);
  const runtimePlan = path.join(planRoot, 'runtime-plan.json');
  const runtimeValue = {
    sourceContext: {
      originalSrt: {locator: '00-inputs/original.srt', sha256: await hashFile(originalSrt)},
      skillUsage,
    },
  };
  runtimeValue.identity = computeRuntimePlanIdentity(runtimeValue);
  await writeFile(runtimePlan, `${JSON.stringify(runtimeValue)}\n`);
  await writeVideoSkillUsage({
    productionRoot: root, videoFile: finalMedia, planIdentity: runtimeValue.identity, binding: skillUsage,
  });
  const editPlan = path.join(planRoot, 'presenter-edit-plan.json');
  await writeFile(editPlan, `${JSON.stringify({
    runtimePlan: {
      file: '01-runtime-plan/runtime-plan.json', sha256: await hashFile(runtimePlan), identity: runtimeValue.identity,
    },
  })}\n`);
  const receipt = path.join(deliveryRoot, 'presenter-broll-master.receipt.json');
  await writeFile(receipt, `${JSON.stringify({
    schemaVersion: '1.0.0', presenterKind: 'digital', compositionScope: 'full-production', authorizationUse: 'publishing',
    inputs: {
      presenterSourceSha256: '1'.repeat(64), deliveryIndexSha256: '2'.repeat(64),
      editPlanSha256: await hashFile(editPlan), shotMedia: [],
    },
    mix: {durationMs: 2000, presenterDurationMs: 500, brollDurationMs: 1500, segments: 3},
    output: {
      file: 'presenter-broll-master.mp4', sha256: await hashFile(baseMedia), durationMs: 2000,
      width: 1080, height: 1920, fps: 30, codec: 'h264', audioStreams: 1, fullDecode: 'passed',
    },
  })}\n`);
  return {root, subtitle, finalMedia};
}

const goodFacts = {
  videoCodec: 'h264', width: 1080, height: 1920, fps: 30, durationMs: 2000,
  audioCodec: 'aac', sampleRate: 48000, channels: 1, audioStreams: 1,
};

test('final delivery gate binds subtitles, preserves composition audio, and enforces loudness', async (t) => {
  const fixture = await deliveryFixture(t);
  const common = {
    productionRoot: fixture.root, finalMediaFile: fixture.finalMedia, subtitleFile: fixture.subtitle,
    writeReceipt: false, probeMedia: async () => goodFacts,
    fingerprintAudio: async () => 'a'.repeat(64),
  };
  const result = await verifyPresenterDelivery({
    ...common, measureAudio: async () => ({meanVolumeDb: -18.1, maxVolumeDb: -1.1}),
  });
  assert.equal(result.status, 'presenter-delivery-passed');
  assert.equal(result.gate.subtitles.exactOriginalSrt, true);
  assert.equal(result.gate.audio.decodedPcmSha256, 'a'.repeat(64));
  await assert.rejects(verifyPresenterDelivery({
    ...common, measureAudio: async () => ({meanVolumeDb: -42.2, maxVolumeDb: -20.1}),
  }), /mean volume/u);
});

test('final delivery gate rejects subtitle drift and replaced audio', async (t) => {
  const fixture = await deliveryFixture(t);
  await writeFile(fixture.subtitle, '1\n00:00:00,000 --> 00:00:01,900\n改写字幕\n');
  await assert.rejects(verifyPresenterDelivery({
    productionRoot: fixture.root, finalMediaFile: fixture.finalMedia, subtitleFile: fixture.subtitle,
    writeReceipt: false, probeMedia: async () => goodFacts,
    fingerprintAudio: async () => 'a'.repeat(64),
    measureAudio: async () => ({meanVolumeDb: -18, maxVolumeDb: -1}),
  }), /byte-identical/u);

  const original = await readFile(path.join(fixture.root, '00-inputs', 'original.srt'));
  await writeFile(fixture.subtitle, original);
  let calls = 0;
  await assert.rejects(verifyPresenterDelivery({
    productionRoot: fixture.root, finalMediaFile: fixture.finalMedia, subtitleFile: fixture.subtitle,
    writeReceipt: false, probeMedia: async () => goodFacts,
    fingerprintAudio: async () => (++calls === 1 ? 'a'.repeat(64) : 'b'.repeat(64)),
    measureAudio: async () => ({meanVolumeDb: -18, maxVolumeDb: -1}),
  }), /does not preserve/u);
});

test('final delivery gate fails when the final MP4 has no skill-usage sidecar', async (t) => {
  const fixture = await deliveryFixture(t);
  await rm(`${fixture.finalMedia}.skill-usage.json`);
  await assert.rejects(verifyPresenterDelivery({
    productionRoot: fixture.root, finalMediaFile: fixture.finalMedia, subtitleFile: fixture.subtitle,
    writeReceipt: false, probeMedia: async () => goodFacts,
    fingerprintAudio: async () => 'a'.repeat(64),
    measureAudio: async () => ({meanVolumeDb: -18, maxVolumeDb: -1}),
  }), /video skill-usage sidecar|ENOENT/u);
});
