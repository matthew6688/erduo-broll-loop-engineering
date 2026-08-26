import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {reuseUnchangedShots} from '../erduo-broll-loop-engineering/scripts/reuse-unchanged-shots.mjs';
import {
  registerSkillUsage, verifySkillUsage, verifyVideoSkillUsage, writeVideoSkillUsage,
} from '../erduo-broll-loop-engineering/scripts/skill-usage.mjs';
import {canonicalJson} from '../erduo-broll-loop-engineering/scripts/runtime-schema-validator.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const jsonIdentity = (value) => `sha256:${sha256(canonicalJson(value))}`;

async function writeJson(file, value) {
  await mkdir(path.dirname(file), {recursive: true});
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reuse-shots-'));
  const previousRoot = path.join(root, 'previous');
  const productionRoot = path.join(root, 'current');
  const authority = path.join(root, 'authority', 'SKILL.md');
  await mkdir(path.dirname(authority), {recursive: true});
  await writeFile(authority, '---\nname: erduo-broll-loop-engineering\ndescription: test\n---\n');
  for (const production of [previousRoot, productionRoot]) {
    await mkdir(path.join(production, '00-inputs'), {recursive: true});
    await registerSkillUsage({
      productionRoot: production, skillFile: authority, skillName: 'erduo-broll-loop-engineering',
    });
  }
  const skillUsage = await verifySkillUsage({productionRoot});
  const recipe = {schemaVersion: '4.0.0', shotId: 'scene-03', truth: {srtWindowMs: {startMs: 0, endMs: 1000}}};
  await writeJson(path.join(productionRoot, '01-director', 'shot-recipes', 'scene-03.json'), recipe);
  const sourceRoot = path.join(productionRoot, '04-visual-lock', 'hyperframes', 'shared-source');
  const sourceFile = path.join(sourceRoot, 'compositions', 'scene-03.html');
  await mkdir(path.dirname(sourceFile), {recursive: true});
  await writeFile(sourceFile, '<main data-composition-id="scene-03"></main>');
  const sourceManifest = {
    schemaVersion: '1.0.0', root: 'shared-source',
    files: [{path: 'compositions/scene-03.html', sha256: sha256(await readFile(sourceFile)), sizeBytes: (await readFile(sourceFile)).length}],
  };
  await writeJson(path.join(productionRoot, '04-visual-lock', 'hyperframes', 'source-manifest.json'), sourceManifest);
  const profileIdentity = 'profile-1';
  const planBase = {
    schemaVersion: '4.0.0', status: 'planned', sourceContext: {skillUsage},
    productionProfile: {identity: profileIdentity},
    shots: [{shotId: 'scene-03', window: {startMs: 0, endMs: 1000}, runtime: 'hyperframes'}],
    authoringUnits: [{unitId: 'U001', shotIds: ['scene-03']}],
  };
  const previousPlan = {...planBase, identity: 'a'.repeat(64)};
  const plan = {...planBase, identity: 'b'.repeat(64)};
  await writeJson(path.join(previousRoot, '01-runtime-plan', 'runtime-plan.json'), previousPlan);
  await writeJson(path.join(productionRoot, '01-runtime-plan', 'runtime-plan.json'), plan);
  await writeJson(path.join(productionRoot, '01-runtime-plan', 'assignments', 'L001.json'), {
    assignmentId: 'L001', role: 'lead', planIdentity: plan.identity,
    shotIds: ['scene-03'], sourceRoot: '04-visual-lock/hyperframes/shared-source',
    output: {workDirectory: '04-visual-lock/hyperframes'},
  });
  const previousMedia = path.join(previousRoot, '05-delivery', 'shots', '001-scene-03.mp4');
  const previousSheet = path.join(previousRoot, '05-delivery', 'checks', '001-scene-03.semantic-check.png');
  await mkdir(path.dirname(previousMedia), {recursive: true});
  await mkdir(path.dirname(previousSheet), {recursive: true});
  await writeFile(previousMedia, 'unchanged-media');
  await writeFile(previousSheet, 'unchanged-sheet');
  const contract = {
    schemaVersion: '1.0.0', order: 1, shotId: 'scene-03', unitId: 'U001',
    srtWindowMs: {start: 0, end: 1000}, localTimeline: {startFrame: 0, frameCount: 30},
    backend: 'hyperframes', renderTarget: {id: 'scene-03', mode: 'direct-runtime-render'},
    sourceIdentity: jsonIdentity(sourceManifest), recipeIdentity: jsonIdentity(recipe),
    profileIdentity: `sha256:${profileIdentity}`,
    media: {path: 'shots/001-scene-03.mp4', sha256: sha256(await readFile(previousMedia))},
    semanticCheck: {
      sourceMedia: 'shots/001-scene-03.mp4', contactSheet: 'checks/001-scene-03.semantic-check.png',
      sha256: sha256(await readFile(previousSheet)), samples: [],
    },
  };
  await writeJson(path.join(previousRoot, '05-delivery', 'shots', '001-scene-03.shot-media.json'), contract);
  await writeVideoSkillUsage({
    productionRoot: previousRoot, videoFile: previousMedia,
    planIdentity: previousPlan.identity, binding: skillUsage,
  });
  return {root, previousRoot, productionRoot, plan, recipe};
}

test('reuses unchanged shot media across plan revisions without rendering', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, {recursive: true, force: true}));
  const result = await reuseUnchangedShots({
    previousProductionRoot: value.previousRoot,
    productionRoot: value.productionRoot,
    shotIds: ['scene-03'],
  });
  assert.equal(result.status, 'reused-unchanged-shots');
  const media = path.join(value.productionRoot, '05-delivery', 'shots', '001-scene-03.mp4');
  assert.equal(await readFile(media, 'utf8'), 'unchanged-media');
  await verifyVideoSkillUsage({
    productionRoot: value.productionRoot, videoFile: media,
    planIdentity: value.plan.identity, binding: value.plan.sourceContext.skillUsage,
  });
  const receipt = JSON.parse(await readFile(
    path.join(value.productionRoot, '05-delivery', 'reuse-receipts', 'scene-03.json'), 'utf8',
  ));
  assert.equal(receipt.status, 'reused-unchanged');
  assert.equal(receipt.previousPlanIdentity, 'a'.repeat(64));
  assert.equal(receipt.planIdentity, 'b'.repeat(64));
});

test('refuses reuse when a shot Recipe changed', async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, {recursive: true, force: true}));
  await writeJson(path.join(value.productionRoot, '01-director', 'shot-recipes', 'scene-03.json'), {
    ...value.recipe, creativeProposal: {motionIdea: 'changed'},
  });
  await assert.rejects(
    reuseUnchangedShots({
      previousProductionRoot: value.previousRoot,
      productionRoot: value.productionRoot,
      shotIds: ['scene-03'],
    }),
    /Recipe identity changed/u,
  );
});
