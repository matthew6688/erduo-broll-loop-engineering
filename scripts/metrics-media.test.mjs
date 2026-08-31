import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createProductionProfile,
} from '../erduo-broll-loop-engineering/scripts/create-production-profile.mjs';
import {
  mezzanineVideoArgs,
  validateMezzaninePolicy,
} from '../erduo-broll-loop-engineering/scripts/frozen-media-policy.mjs';
import {
  recordProductionEvent,
  runTimedProductionStage,
} from '../erduo-broll-loop-engineering/scripts/record-production-event.mjs';
import {
  collectProductionMetrics,
  observabilityCoverage,
} from '../erduo-broll-loop-engineering/scripts/collect-production-metrics.mjs';
import {
  verifyLightweightCodec,
} from '../erduo-broll-loop-engineering/scripts/verify-lightweight-codec.mjs';
import {
  computeAnimationExtensionIdentity,
  validateAnimationExtension,
} from '../erduo-broll-loop-engineering/scripts/validate-animation-extension.mjs';

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'erduo-v1-metrics-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('v1 profile defaults to lightweight high-quality H.264 and lossless requires a reason', () => {
  const profile = createProductionProfile();
  assert.deepEqual({
    container: profile.mezzanine.container,
    codec: profile.mezzanine.codec,
    encoder: profile.mezzanine.encoder,
    preset: profile.mezzanine.preset,
    crf: profile.mezzanine.crf,
    gopFrames: profile.mezzanine.gopFrames,
    pixelFormat: profile.mezzanine.pixelFormat,
    class: profile.mezzanine.class,
  }, {
    container: 'mp4', codec: 'h264', encoder: 'libx264', preset: 'medium',
    crf: 12, gopFrames: 60, pixelFormat: 'yuv420p', class: 'visually-lossless',
  });
  assert.deepEqual(validateMezzaninePolicy(profile.mezzanine), []);
  assert.match(mezzanineVideoArgs(profile).join(' '), /-g 60 -keyint_min 60 -sc_threshold 0/u);
  assert.throws(
    () => createProductionProfile({ mezzanineFormat: 'ffv1-mkv' }),
    /reason is required/u,
  );
  const lossless = createProductionProfile({
    mezzanineFormat: 'ffv1-mkv', mezzanineReason: 'hybrid-cross-backend-exchange',
  });
  assert.equal(lossless.mezzanine.codec, 'ffv1');
  assert.equal(lossless.mezzanine.class, 'lossless');
  assert.equal(lossless.mezzanine.upgradeReason, 'hybrid-cross-backend-exchange');
  assert.deepEqual(validateMezzaninePolicy(lossless.mezzanine), []);
});

test('production metrics use one public-safe scan and preserve unknown host token facts', async (t) => {
  const root = await temporary(t);
  const eventsFile = path.join(root, 'production-events.ndjson');
  await mkdir(path.join(root, '03-build', 'U001', 'source'), { recursive: true });
  await writeFile(path.join(root, '03-build', 'U001', 'source', 'index.js'), 'export default 1;\n');
  await writeFile(path.join(root, '03-build', 'U001', 'unit.mp4'), Buffer.alloc(64));
  await writeFile(path.join(root, '03-build', 'U001', 'diagnostic.png'), Buffer.alloc(16));
  const identity = createHash('sha256').update('plan').digest('hex');
  await mkdir(path.join(root, '01-runtime-plan'), { recursive: true });
  await writeFile(path.join(root, '01-runtime-plan', 'runtime-plan.json'), JSON.stringify({
    identity, status: 'planned', authoringUnits: [{
      unitId: 'U001', runtime: 'hyperframes', shotIds: ['S01', 'S02'],
      window: { startMs: 0, endMs: 12_000 },
    }],
  }));
  const base = {
    eventsFile, occurredAt: '2026-08-17T00:00:00.000Z',
  };
  await recordProductionEvent({ ...base, eventId: 'e1', type: 'stage-start', stage: 'builder', spanId: 'builder-U001', unitId: 'U001' });
  await recordProductionEvent({ ...base, eventId: 'e2', occurredAt: '2026-08-17T00:00:12.000Z', type: 'agent-call', agentRole: 'builder', contextMode: 'minimal', unitId: 'U001' });
  await recordProductionEvent({ ...base, eventId: 'e3', occurredAt: '2026-08-17T00:00:13.000Z', type: 'operation', operation: 'render', bytesProcessed: 64, unitId: 'U001' });
  await recordProductionEvent({ ...base, eventId: 'e4', occurredAt: '2026-08-17T00:00:15.000Z', type: 'operation', operation: 'full-decode', bytesProcessed: 64, unitId: 'U001' });
  await recordProductionEvent({ ...base, eventId: 'e5', occurredAt: '2026-08-17T00:00:20.000Z', type: 'stage-end', stage: 'builder', spanId: 'builder-U001', unitId: 'U001', status: 'passed' });
  await recordProductionEvent({ ...base, eventId: 'e6', occurredAt: '2026-08-17T00:00:30.000Z', type: 'stage-start', stage: 'lead-builder', spanId: 'render-U002', unitId: 'U002' });
  await recordProductionEvent({ ...base, eventId: 'e7', occurredAt: '2026-08-17T00:00:40.000Z', type: 'stage-end', stage: 'lead-builder', spanId: 'render-U002', unitId: 'U002', status: 'passed' });
  await recordProductionEvent({ ...base, eventId: 'e8', occurredAt: '2026-08-17T00:00:55.000Z', type: 'stage-start', stage: 'builder', spanId: 'receipt-U002', unitId: 'U002' });
  await recordProductionEvent({ ...base, eventId: 'e9', occurredAt: '2026-08-17T00:00:56.000Z', type: 'stage-end', stage: 'builder', spanId: 'receipt-U002', unitId: 'U002', status: 'passed' });
  const output = path.join(root, 'production-metrics-canary.json');
  const result = await collectProductionMetrics({
    productionRoot: root, milestone: 'canary', outputFile: output,
    now: () => new Date('2026-08-17T00:01:00.000Z'),
  });
  assert.equal(result.metrics.stages[0].wallClockMs, 20_000);
  assert.equal(result.metrics.milestone, 'canary');
  assert.deepEqual(result.metrics.phaseSummary['stage:builder'], {
    spans: 2, completed: 2, failed: 0, wallClockMs: 21_000,
  });
  assert.equal(result.metrics.observabilityCoverage.status, 'incomplete');
  assert.equal(result.metrics.observabilityCoverage.productionKind, 'broll');
  assert.ok(result.metrics.observabilityCoverage.missingPhases.includes('creative-authoring'));
  assert.deepEqual(result.metrics.reviewWaits, [{
    unitId: 'U002', renderEndedAt: '2026-08-17T00:00:40.000Z',
    receiptStartedAt: '2026-08-17T00:00:55.000Z', wallClockMs: 15_000,
  }]);
  assert.deepEqual(result.metrics.agentCalls, {
    total: 1, director: 0, assets: 0, builder: 1, revision: 0, other: 0, fullHistory: 0,
  });
  assert.deepEqual(result.metrics.operations.render, { count: 1, bytesProcessed: 64 });
  assert.deepEqual(result.metrics.operations['full-decode'], { count: 1, bytesProcessed: 64 });
  assert.equal(result.metrics.plan.units[0].shotCount, 2);
  assert.equal(result.metrics.plan.units[0].durationMs, 12_000);
  assert.equal(result.metrics.files.scanPasses, 1);
  assert.equal(result.metrics.files.byKind.video.count, 1);
  assert.equal(result.metrics.files.byKind.png.count, 1);
  assert.equal(result.metrics.tokens.status, 'unknown');
  assert.equal(result.metrics.privacy.privateSessionPathsRead, false);
  assert.equal((await readFile(output, 'utf8')).includes(root), false);
  await assert.rejects(
    collectProductionMetrics({ productionRoot: root, milestone: 'canary', outputFile: output }),
    /already exists/u,
  );
  const fullPreview = await collectProductionMetrics({
    productionRoot: root, milestone: 'full-preview',
    now: () => new Date('2026-08-17T00:02:00.000Z'),
  });
  assert.equal(path.basename(fullPreview.file), 'production-metrics-full-preview.json');
  assert.equal(fullPreview.metrics.milestone, 'full-preview');
  assert.notEqual(fullPreview.file, output);
  await assert.rejects(
    collectProductionMetrics({ productionRoot: root, milestone: 'draft' }),
    /milestone must be/u,
  );
});

test('production commands emit a closed stage span for success and failure', async (t) => {
  const root = await temporary(t);
  const eventsFile = path.join(root, 'production-events.ndjson');
  const moments = [
    new Date('2026-08-27T00:00:00.000Z'),
    new Date('2026-08-27T00:00:02.500Z'),
    new Date('2026-08-27T00:00:03.000Z'),
    new Date('2026-08-27T00:00:04.000Z'),
  ];
  let index = 0;
  const now = () => moments[index++];
  assert.equal(await runTimedProductionStage({
    eventsFile, stage: 'runtime-plan', phase: 'runtime-planning', spanId: 'runtime-plan-main', now,
  }, async () => 'planned'), 'planned');
  await assert.rejects(runTimedProductionStage({
    eventsFile, stage: 'delivery', spanId: 'canary-finalize', now,
  }, async () => { throw new Error('gate failed'); }), /gate failed/u);
  const events = (await readFile(eventsFile, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map(({type, stage, phase, spanId, status}) => ({type, stage, phase, spanId, status})), [
    {type: 'stage-start', stage: 'runtime-plan', phase: 'runtime-planning', spanId: 'runtime-plan-main', status: undefined},
    {type: 'stage-end', stage: 'runtime-plan', phase: 'runtime-planning', spanId: 'runtime-plan-main', status: 'passed'},
    {type: 'stage-start', stage: 'delivery', phase: undefined, spanId: 'canary-finalize', status: undefined},
    {type: 'stage-end', stage: 'delivery', phase: undefined, spanId: 'canary-finalize', status: 'failed'},
  ]);
  assert.equal(Date.parse(events[1].occurredAt) - Date.parse(events[0].occurredAt), 2500);
});

test('final presenter metrics disclose every missing presenter and delivery phase', () => {
  const coverage = observabilityCoverage({
    milestone: 'final',
    plan: {sourceContext: {presenterSource: {presenterKind: 'digital'}}},
    stages: [{phase: 'runtime-planning'}],
  });
  assert.equal(coverage.productionKind, 'presenter');
  assert.equal(coverage.status, 'incomplete');
  for (const phase of [
    'presenter-edit-plan', 'presenter-assembly', 'subtitles', 'pixel-review', 'final-delivery',
  ]) assert.ok(coverage.missingPhases.includes(phase));
});

test('animation extensions preserve original DesignMD and fail closed on evidence drift', async (t) => {
  const root = await temporary(t);
  await mkdir(path.join(root, 'source'), {recursive: true});
  await mkdir(path.join(root, 'evidence'), {recursive: true});
  const files = {
    implementation: path.join(root, 'source', 'animation.js'),
    check: path.join(root, 'evidence', 'check.json'),
    preview: path.join(root, 'evidence', 'preview.mp4'),
  };
  await writeFile(files.implementation, 'export const progress = (t) => t;\n');
  await writeFile(files.check, '{"status":"passed"}\n');
  await writeFile(files.preview, Buffer.alloc(32, 7));
  const digest = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
  const manifest = {
    schemaVersion: '1.0.0', identity: '0'.repeat(64), id: 'workflow-progress',
    kind: 'hyperframes-block', status: 'candidate',
    intent: 'Reveal verified workflow progress through stable semantic stages.',
    runtime: {provider: 'hyperframes', version: '0.7.104'},
    designMdPolicy: 'preserve-original',
    implementation: {locator: 'source/animation.js', sha256: await digest(files.implementation)},
    verification: [
      {kind: 'check-receipt', artifact: {locator: 'evidence/check.json', sha256: await digest(files.check)}},
      {kind: 'preview', artifact: {locator: 'evidence/preview.mp4', sha256: await digest(files.preview)}},
    ],
    canaryEvidence: null,
  };
  manifest.identity = computeAnimationExtensionIdentity(manifest);
  const manifestFile = path.join(root, 'extension.json');
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.deepEqual(await validateAnimationExtension({root, manifestFile}), {
    status: 'verified', id: 'workflow-progress', lifecycle: 'candidate', identity: manifest.identity,
  });
  await writeFile(files.preview, Buffer.alloc(32, 8));
  await assert.rejects(validateAnimationExtension({root, manifestFile}), /preview.*sha256 does not match/u);
  await writeFile(files.preview, Buffer.alloc(32, 7));
  const approved = structuredClone(manifest);
  approved.status = 'canary-approved';
  approved.identity = computeAnimationExtensionIdentity(approved);
  await writeFile(manifestFile, `${JSON.stringify(approved, null, 2)}\n`);
  await assert.rejects(validateAnimationExtension({root, manifestFile}), /requires canary evidence/u);
});

test('real FFmpeg fixture proves H.264 and FFV1 decode plus continuous concat', async (t) => {
  try {
    const result = await verifyLightweightCodec({ comparePresets: false });
    assert.equal(result.status, 'passed');
    assert.equal(result.unit.codec, 'h264');
    assert.equal(result.losslessControl.codec, 'ffv1');
    assert.equal(result.streamCopy.frameCount, 60);
    assert.equal(result.finalSingleReencode.frameCount, 60);
    assert.ok(result.fixtureBytes.units < result.fixtureBytes.losslessControl);
  } catch (error) {
    if (error?.code === 'ENOENT') t.skip('FFmpeg is not installed');
    else throw error;
  }
});
