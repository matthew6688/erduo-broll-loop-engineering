import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  registerSkillUsage,
  verifySkillUsage,
  verifyVideoSkillUsage,
  writeVideoSkillUsage,
} from '../erduo-broll-loop-engineering/scripts/skill-usage.mjs';

test('installed CLI entry executes through a symbolic-link Skill root', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'erduo-symlink-cli-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const productionRoot = path.join(root, 'production');
  const skillFile = path.join(root, 'authority', 'SKILL.md');
  await mkdir(path.join(productionRoot, '00-inputs'), {recursive: true});
  await mkdir(path.dirname(skillFile), {recursive: true});
  await writeFile(skillFile, '---\nname: erduo-broll-loop-engineering\n---\n');
  const actualScript = path.resolve('erduo-broll-loop-engineering/scripts/register-skill-usage.mjs');
  const linkedScript = path.join(root, 'installed-skill', 'scripts', 'register-skill-usage.mjs');
  await mkdir(path.dirname(linkedScript), {recursive: true});
  await symlink(actualScript, linkedScript);

  const result = spawnSync(process.execPath, [
    linkedScript,
    '--production-root', productionRoot,
    '--skill-file', skillFile,
    '--skill-name', 'erduo-broll-loop-engineering',
  ], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"status":"skill-usage-registered"/u);
  assert.equal(
    JSON.parse(await readFile(path.join(productionRoot, '00-inputs', 'skill-usage.json'), 'utf8')).used,
    true,
  );
});

test('skill usage and every video sidecar fail closed on absence, false claims, or media drift', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'erduo-skill-usage-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, '00-inputs'));
  const skill = path.join(root, 'authority', 'SKILL.md');
  await mkdir(path.dirname(skill));
  await writeFile(skill, '---\nname: erduo-broll-loop-engineering\n---\n\n# Bound instructions\n');
  await assert.rejects(verifySkillUsage({productionRoot: root}), /ENOENT/u);
  await registerSkillUsage({
    productionRoot: root, skillFile: skill, skillName: 'erduo-broll-loop-engineering',
  });
  const binding = await verifySkillUsage({productionRoot: root});
  assert.equal(binding.used, true);
  const registered = JSON.parse(await readFile(path.join(root, '00-inputs', 'skill-usage.json'), 'utf8'));
  assert.equal(registered.executionPolicy.designAuthority, 'bound-original-design-only');
  assert.equal(registered.executionPolicy.unapprovedCreativeAdditions, 'forbidden');
  assert.equal(registered.executionPolicy.legacyBackfill, 'forbidden');

  const video = path.join(root, '05-delivery', 'sample.mp4');
  await mkdir(path.dirname(video), {recursive: true});
  await writeFile(video, 'video-v1');
  await writeVideoSkillUsage({productionRoot: root, videoFile: video, planIdentity: 'a'.repeat(64), binding});
  assert.equal((await verifyVideoSkillUsage({
    productionRoot: root, videoFile: video, planIdentity: 'a'.repeat(64), binding,
  })).status, 'video-skill-usage-passed');
  await writeFile(video, 'video-v2');
  await assert.rejects(verifyVideoSkillUsage({
    productionRoot: root, videoFile: video, planIdentity: 'a'.repeat(64), binding,
  }), /stale|different media/u);

  const contractFile = path.join(root, '00-inputs', 'skill-usage.json');
  const contract = JSON.parse(await readFile(contractFile, 'utf8'));
  contract.used = false;
  await writeFile(contractFile, `${JSON.stringify(contract)}\n`);
  await assert.rejects(verifySkillUsage({productionRoot: root}), /schema validation|not confirmed/u);
});
