import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {access, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {writeProductionProfile} from '../erduo-broll-loop-engineering/scripts/create-production-profile.mjs';
import {splitVideoFilters} from '../erduo-broll-loop-engineering/scripts/assemble-presenter-broll.mjs';
import {
  compilePresenterSegments, createPresenterEditPlan,
} from '../erduo-broll-loop-engineering/scripts/create-presenter-edit-plan.mjs';
import {
  bindPresentationModeContext, createPresentationMode,
} from '../erduo-broll-loop-engineering/scripts/presentation-mode.mjs';
import {runCommand} from '../erduo-broll-loop-engineering/scripts/shot-media-lib.mjs';
import {computeRuntimePlanIdentity} from '../erduo-broll-loop-engineering/scripts/validate-runtime-plan.mjs';

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

function presenterSource(kind = 'digital') {
  const mediaSha256 = sha(`${kind}-media`);
  return {
    schemaVersion: '1.0.0', presenterKind: kind, provider: 'fixture',
    inputIdentity: {
      srt: {file: '00-inputs/source.srt', sha256: sha('srt')},
      portrait: {file: '00-inputs/portrait.png', sha256: sha('portrait')},
      narration: {file: '00-inputs/narration.wav', sha256: sha('narration')},
    },
    alignment: {method: 'provided', status: 'confirmed'},
    authorization: {likeness: 'confirmed', voice: 'confirmed', use: 'internal-canary'},
    approval: {
      scope: 'canary', approvedBy: 'user', approvedMediaSha256: mediaSha256,
      identity: 'approved', voice: 'approved', lipSync: 'approved',
    },
    media: {
      file: '00-inputs/presenter.mp4', sha256: mediaSha256, durationMs: 4000,
      width: 1920, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac',
      sampleRate: 48000, channels: 2, fullDecode: 'passed',
    },
  };
}

async function fixture(t, {width = 1080, height = 1920, kind = 'digital'} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'presentation-mode-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const inputs = path.join(root, '00-inputs');
  await mkdir(inputs);
  const designFile = path.join(inputs, 'design.md');
  const profileFile = path.join(inputs, 'production-profile.json');
  const presenterFile = path.join(inputs, 'presenter-source.json');
  await Promise.all([
    writeFile(designFile, '# Original DesignMD\n'),
    writeFile(presenterFile, `${JSON.stringify(presenterSource(kind))}\n`),
    writeProductionProfile({outputFile: profileFile, width, height}),
  ]);
  return {root, inputs, designFile, profileFile, presenterFile};
}

test('original and avatar-center freeze existing full-frame behavior without a theme override', async (t) => {
  const value = await fixture(t);
  const original = await createPresentationMode({
    productionRoot: value.root, mode: 'original', originalDesignFile: value.designFile,
    productionProfileFile: value.profileFile, outputFile: path.join(value.inputs, 'original.json'),
    approvalStatus: 'approved', approvedBy: 'user',
  });
  assert.equal(original.presentationMode.designPolicy.themeOverride, false);
  assert.deepEqual(original.presentationMode.output, {width: 1080, height: 1920, fps: 30});
  await assert.rejects(createPresentationMode({
    productionRoot: value.root, mode: 'avatar-center', originalDesignFile: value.designFile,
    productionProfileFile: value.profileFile, outputFile: path.join(value.inputs, 'center-missing.json'),
    approvalStatus: 'approved', approvedBy: 'user',
  }), /requires a bound digital presenter/u);
  const center = await createPresentationMode({
    productionRoot: value.root, mode: 'avatar-center', originalDesignFile: value.designFile,
    productionProfileFile: value.profileFile, presenterSourceFile: value.presenterFile,
    outputFile: path.join(value.inputs, 'center.json'), approvalStatus: 'approved', approvedBy: 'user',
  });
  assert.equal(center.presentationMode.presenter.position, 'center');
  assert.equal(center.presentationMode.broll.defaultLayout, 'full-frame-cutaway');
});

test('avatar-split binds portrait B-roll to a landscape output and rejects drafts at Runtime planning', async (t) => {
  const value = await fixture(t);
  const draftFile = path.join(value.inputs, 'draft.json');
  await createPresentationMode({
    productionRoot: value.root, mode: 'avatar-split', originalDesignFile: value.designFile,
    productionProfileFile: value.profileFile, presenterSourceFile: value.presenterFile,
    outputFile: draftFile,
  });
  const profile = JSON.parse(await readFile(value.profileFile, 'utf8'));
  await assert.rejects(bindPresentationModeContext({
    productionRoot: value.root, presentationModeFile: draftFile,
    originalDesignFile: value.designFile, presenterSourceFile: value.presenterFile,
    productionProfile: profile,
  }), /user-approved presentation mode/u);
  const approvedFile = path.join(value.inputs, 'presentation-mode.json');
  const approved = await createPresentationMode({
    productionRoot: value.root, mode: 'avatar-split', originalDesignFile: value.designFile,
    productionProfileFile: value.profileFile, presenterSourceFile: value.presenterFile,
    outputFile: approvedFile, approvalStatus: 'approved', approvedBy: 'user',
  });
  assert.deepEqual(approved.presentationMode.output, {width: 1920, height: 1080, fps: 30});
  assert.equal(approved.presentationMode.broll.sourceAspect, '9:16');
  const binding = await bindPresentationModeContext({
    productionRoot: value.root, presentationModeFile: approvedFile,
    originalDesignFile: value.designFile, presenterSourceFile: value.presenterFile,
    productionProfile: profile,
  });
  assert.equal(binding.mode, 'avatar-split');
  assert.equal(binding.locator, '00-inputs/presentation-mode.json');
});

test('avatar-split refuses landscape B-roll and compiles mixed windows to split by default', async (t) => {
  const value = await fixture(t, {width: 1920, height: 1080});
  await assert.rejects(createPresentationMode({
    productionRoot: value.root, mode: 'avatar-split', originalDesignFile: value.designFile,
    productionProfileFile: value.profileFile, presenterSourceFile: value.presenterFile,
    outputFile: path.join(value.inputs, 'invalid-split.json'),
    approvalStatus: 'approved', approvedBy: 'user',
  }), /portrait B-roll production profile/u);
  const recipe = {
    shotId: 'S01', truth: {srtWindowMs: {startMs: 1000, endMs: 3000}},
    creativeProposal: {presenterTreatment: {
      mode: 'mixed', reason: 'Show evidence beside the presenter.',
      brollWindows: [{startMs: 1500, endMs: 2500}],
    }},
  };
  assert.deepEqual(compilePresenterSegments([recipe], 4000, 'avatar-split'), [
    {kind: 'presenter', startMs: 0, endMs: 1500},
    {kind: 'split', shotId: 'S01', startMs: 1500, endMs: 2500},
    {kind: 'presenter', startMs: 2500, endMs: 4000},
  ]);
  recipe.creativeProposal.presenterTreatment.brollWindows[0].presentation = 'full';
  assert.equal(compilePresenterSegments([recipe], 4000, 'avatar-split')[1].kind, 'broll');
});

test('presenter edit plan v3 binds avatar-split mode and compiles a landscape split timeline', async (t) => {
  const value = await fixture(t);
  const modeFile = path.join(value.inputs, 'presentation-mode.json');
  await createPresentationMode({
    productionRoot: value.root, mode: 'avatar-split', originalDesignFile: value.designFile,
    productionProfileFile: value.profileFile, presenterSourceFile: value.presenterFile,
    outputFile: modeFile, approvalStatus: 'approved', approvedBy: 'user',
  });
  const [profile, source] = await Promise.all([
    readFile(value.profileFile, 'utf8').then(JSON.parse),
    readFile(value.presenterFile, 'utf8').then(JSON.parse),
  ]);
  const presentationBinding = await bindPresentationModeContext({
    productionRoot: value.root, presentationModeFile: modeFile,
    originalDesignFile: value.designFile, presenterSourceFile: value.presenterFile,
    productionProfile: profile,
  });
  const recipes = path.join(value.root, '01-director', 'shot-recipes');
  const planDirectory = path.join(value.root, '01-runtime-plan');
  await Promise.all([mkdir(recipes, {recursive: true}), mkdir(planDirectory, {recursive: true})]);
  await writeFile(path.join(recipes, 'S01.json'), `${JSON.stringify({
    schemaVersion: '4.0.0', shotId: 'S01',
    truth: {
      chapterId: 'C01', srtWindowMs: {startMs: 1000, endMs: 3000}, sourceCues: ['cue-1'],
      spokenFacts: ['One fact.'], audienceOutcome: 'Understand the fact.',
      requiredReadableResult: 'The fact is readable.', incomingSeam: 'cut', outgoingSeam: 'cut',
    },
    creativeProposal: {
      metaphor: 'Evidence beside the presenter.', objects: ['evidence'], composition: 'full-bleed-material',
      motionIdea: 'Evidence resolves.', materialRoute: 'native', keyStates: ['opening', 'result'],
      whyThisCouldWork: 'It preserves the presenter while showing the evidence.',
      presenterTreatment: {
        mode: 'mixed', reason: 'Keep the speaker visible.',
        brollWindows: [{startMs: 1500, endMs: 2500}],
      },
    },
    craftIntent: ['staging', 'timing'],
  })}\n`);
  const runtimePlan = {
    schemaVersion: '4.0.0',
    sourceContext: {
      originalSrt: {sha256: source.inputIdentity.srt.sha256},
      originalDesign: {locator: '00-inputs/design.md', sha256: sha(await readFile(value.designFile)), readable: true},
      presenterSource: {
        locator: '00-inputs/presenter-source.json', sha256: sha(await readFile(value.presenterFile)),
        mediaSha256: source.media.sha256, durationMs: source.media.durationMs,
        authorizationUse: source.authorization.use, approvalScope: source.approval.scope,
        presenterKind: source.presenterKind,
      },
      presentationMode: presentationBinding,
    },
    productionProfile: profile,
  };
  runtimePlan.identity = computeRuntimePlanIdentity(runtimePlan);
  const runtimePlanFile = path.join(planDirectory, 'runtime-plan.json');
  await writeFile(runtimePlanFile, `${JSON.stringify(runtimePlan)}\n`);
  const result = await createPresenterEditPlan({
    productionRoot: value.root, runtimePlanFile, recipesDirectory: recipes,
    presenterSourceFile: value.presenterFile,
    outputFile: path.join(planDirectory, 'presenter-edit-plan.json'), compositionScope: 'canary',
    verifyRuntimePlan: async () => ({status: 'valid'}),
  });
  assert.equal(result.plan.schemaVersion, '3.0.0');
  assert.equal(result.plan.presentationMode, 'avatar-split');
  assert.deepEqual(result.plan.output, {width: 1920, height: 1080, fps: 30});
  assert.equal(result.plan.segments[1].kind, 'split');
});

test('avatar-split soft-boundary filter executes with a full-frame presenter base and portrait B-roll', async (t) => {
  const available = await runCommand({executable: 'ffmpeg', args: ['-version']});
  if (available.code !== 0) {
    t.skip('FFmpeg is not installed');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'presentation-filter-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, 'split.mp4');
  const filters = splitVideoFilters({
    presenterInput: 0, brollInput: 1, startMs: 0, endMs: 1000,
    brollStartMs: 0, brollEndMs: 1000, width: 1920, height: 1080,
    fps: 30, output: 'vout', index: 0,
  });
  assert.match(filters.join(';'), /gblur=.*overlay=.*overlay=/u);
  const result = await runCommand({
    executable: 'ffmpeg', cwd: root,
    args: [
      '-v', 'error', '-nostdin',
      '-f', 'lavfi', '-i', 'color=c=0x20242b:s=1920x1080:r=30:d=1',
      '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30:d=1',
      '-filter_complex', filters.join(';'), '-map', '[vout]', '-an',
      '-frames:v', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-n', output,
    ],
  });
  assert.equal(result.code, 0, result.stderr);
  await access(output);
});
