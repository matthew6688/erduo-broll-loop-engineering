import {createHash} from 'node:crypto';
import {lstat, readFile, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {canonicalJson, validateSchemaValue} from './runtime-schema-validator.mjs';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const schemaRoot = path.resolve(scriptRoot, '..', 'references', 'runtime');
export const SKILL_USAGE_LOCATOR = '00-inputs/skill-usage.json';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function identity(value) {
  const {identity: _identity, ...input} = value;
  return sha256(canonicalJson(input));
}

async function schema(name) {
  return JSON.parse(await readFile(path.join(schemaRoot, name), 'utf8'));
}

async function assertSchema(value, name, label) {
  const contract = await schema(name);
  const errors = validateSchemaValue(value, contract, contract);
  if (errors.length) throw new Error(`${label} failed schema validation:\n- ${errors.join('\n- ')}`);
}

async function regular(file, label) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a real regular file`);
  return file;
}

function within(root, file, label) {
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the production root`);
  }
  return relative.split(path.sep).join('/');
}

export async function registerSkillUsage({productionRoot, skillFile, skillName}) {
  const root = await realpath(path.resolve(productionRoot));
  const canonicalSkill = await realpath(path.resolve(skillFile));
  await regular(canonicalSkill, 'skill authority');
  if (path.basename(canonicalSkill) !== 'SKILL.md') throw new Error('skill authority must be a SKILL.md file');
  const skillBody = await readFile(canonicalSkill);
  const declaredName = /^---\s*[\s\S]*?^name:\s*([^\r\n]+)$/mu.exec(skillBody.toString('utf8'))?.[1]?.trim();
  if (!declaredName || declaredName !== skillName) throw new Error('skill name differs from SKILL.md frontmatter');
  const value = {
    schemaVersion: '1.0.0', status: 'required', used: true,
    skill: {name: skillName, locator: canonicalSkill, sha256: sha256(skillBody)},
    scope: 'video-production',
    executionPolicy: {
      designAuthority: 'bound-original-design-only',
      unapprovedCreativeAdditions: 'forbidden',
      presenterIntegration: 'separate-post-baseline-stage',
      userAestheticApproval: 'required-before-full-production',
      legacyBackfill: 'forbidden',
    },
    registeredBy: 'parent-producer', identity: '',
  };
  value.identity = identity(value);
  await assertSchema(value, 'skill-usage.schema.json', 'skill usage contract');
  const output = path.join(root, SKILL_USAGE_LOCATOR);
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, {flag: 'wx'});
  return {status: 'skill-usage-registered', file: output, identity: value.identity};
}

export async function verifySkillUsage({productionRoot, skillUsageFile}) {
  const root = await realpath(path.resolve(productionRoot));
  const file = await realpath(path.resolve(skillUsageFile ?? path.join(root, SKILL_USAGE_LOCATOR)));
  if (within(root, file, 'skill usage contract') !== SKILL_USAGE_LOCATOR) {
    throw new Error(`skill usage contract locator must be ${SKILL_USAGE_LOCATOR}`);
  }
  await regular(file, 'skill usage contract');
  const body = await readFile(file);
  let value;
  try { value = JSON.parse(body.toString('utf8')); } catch { throw new Error('skill usage contract is invalid JSON'); }
  await assertSchema(value, 'skill-usage.schema.json', 'skill usage contract');
  if (value.used !== true || identity(value) !== value.identity) throw new Error('skill usage contract is not confirmed or has stale identity');
  const canonicalSkill = await realpath(value.skill.locator);
  await regular(canonicalSkill, 'bound skill authority');
  const skillBody = await readFile(canonicalSkill);
  if (canonicalSkill !== value.skill.locator || sha256(skillBody) !== value.skill.sha256) {
    throw new Error('bound SKILL.md locator or hash has drifted');
  }
  return {
    locator: SKILL_USAGE_LOCATOR,
    sha256: sha256(body),
    identity: value.identity,
    used: true,
    skillName: value.skill.name,
    skillSha256: value.skill.sha256,
  };
}

export async function writeVideoSkillUsage({productionRoot, videoFile, planIdentity, binding, outputFile}) {
  const root = await realpath(path.resolve(productionRoot));
  const video = await realpath(path.resolve(videoFile));
  await regular(video, 'video skill-usage target');
  const current = await verifySkillUsage({productionRoot: root});
  if (canonicalJson(current) !== canonicalJson(binding)) throw new Error('planned skill usage differs from the current contract');
  const value = {
    schemaVersion: '1.0.0', used: true,
    video: {locator: within(root, video, 'video'), sha256: sha256(await readFile(video))},
    skillUsage: {
      contractLocator: binding.locator,
      contractSha256: binding.sha256,
      contractIdentity: binding.identity,
      skillName: binding.skillName,
      skillSha256: binding.skillSha256,
    },
    planIdentity,
    identity: '',
  };
  value.identity = identity(value);
  await assertSchema(value, 'video-skill-usage.schema.json', 'video skill-usage sidecar');
  const output = path.resolve(outputFile ?? `${video}.skill-usage.json`);
  within(root, output, 'video skill-usage sidecar');
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, {flag: 'wx'});
  return {status: 'video-skill-usage-ready', file: output, identity: value.identity};
}

export async function verifyVideoSkillUsage({productionRoot, videoFile, planIdentity, binding, sidecarFile}) {
  const root = await realpath(path.resolve(productionRoot));
  const video = await realpath(path.resolve(videoFile));
  const sidecar = path.resolve(sidecarFile ?? `${video}.skill-usage.json`);
  await Promise.all([regular(video, 'video'), regular(sidecar, 'video skill-usage sidecar')]);
  const current = await verifySkillUsage({productionRoot: root});
  if (canonicalJson(current) !== canonicalJson(binding)) throw new Error('planned skill usage differs from the current contract');
  const value = JSON.parse(await readFile(sidecar, 'utf8'));
  await assertSchema(value, 'video-skill-usage.schema.json', 'video skill-usage sidecar');
  if (value.used !== true || identity(value) !== value.identity
    || value.video.locator !== within(root, video, 'video')
    || value.video.sha256 !== sha256(await readFile(video))
    || value.planIdentity !== planIdentity
    || canonicalJson(value.skillUsage) !== canonicalJson({
      contractLocator: binding.locator, contractSha256: binding.sha256,
      contractIdentity: binding.identity, skillName: binding.skillName,
      skillSha256: binding.skillSha256,
    })) {
    throw new Error('video skill-usage sidecar is missing, false, stale, or bound to different media');
  }
  return {status: 'video-skill-usage-passed', identity: value.identity};
}
