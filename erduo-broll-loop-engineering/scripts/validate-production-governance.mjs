#!/usr/bin/env node

import {createHash} from 'node:crypto';
import {lstat, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {canonicalJson, validateSchemaValue} from './runtime-schema-validator.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaRoot = path.join(skillRoot, 'references', 'runtime');
export const GOVERNANCE_LOCK_LOCATOR = 'production-governance.lock.json';
export const GOVERNANCE_CONTRACT_LOCATOR = '00-inputs/production-governance.json';
const REQUIRED_STAGES = Object.freeze([
  'director', 'runtime-plan', 'assets', 'lead', 'chapter-builder',
  'parent-audits', 'user-canary', 'full-production',
]);

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function governanceIdentity(value) {
  const {identity: _identity, ...input} = value;
  return digest(canonicalJson(input));
}

async function regularFile(file, label) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  return info;
}

function resolveLocator(productionRoot, locator, label) {
  if (typeof locator !== 'string' || locator.length === 0) throw new Error(`${label} locator is required`);
  if (path.isAbsolute(locator)) return path.resolve(locator);
  const root = path.resolve(productionRoot);
  const absolute = path.resolve(root, locator);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} locator escapes the production root`);
  }
  return absolute;
}

async function readJson(file, label) {
  await regularFile(file, label);
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new Error(`${label} is invalid JSON`); }
}

async function assertSchema(value, name, label) {
  const schema = await readJson(path.join(schemaRoot, name), `${label} schema`);
  const errors = validateSchemaValue(value, schema, schema);
  if (errors.length) throw new Error(`${label} failed schema validation:\n- ${errors.join('\n- ')}`);
}

async function bindDraftFile(productionRoot, entry, label) {
  const file = resolveLocator(productionRoot, entry?.locator, label);
  await regularFile(file, label);
  return {...entry, sha256: digest(await readFile(file))};
}

function normalizedColors(values) {
  return new Set(values.map((value) => value.toLowerCase()));
}

function assertWorkflow(contract) {
  if (canonicalJson(contract.workflow.stages) !== canonicalJson(REQUIRED_STAGES)) {
    throw new Error(`governance workflow stages must be exactly ${REQUIRED_STAGES.join(' -> ')}`);
  }
  const allowed = normalizedColors(contract.rules.allowedColors);
  const required = normalizedColors(contract.rules.requiredColors);
  const forbidden = normalizedColors(contract.rules.forbiddenColors);
  for (const color of required) if (!allowed.has(color)) throw new Error(`required color ${color} is not allowed`);
  for (const color of forbidden) if (allowed.has(color)) throw new Error(`forbidden color ${color} is also allowed`);
  const allowedFonts = new Set(contract.rules.allowedFontFamilies.map((value) => value.toLowerCase()));
  for (const family of contract.rules.requiredFontFamilies) {
    if (!allowedFonts.has(family.toLowerCase())) throw new Error(`required font ${family} is not allowed`);
  }
}

function assertTextRules(body, contract, label, {
  requireAllColors = true,
  requireLogo = true,
  rejectForbiddenTerms = true,
} = {}) {
  const lower = body.toLowerCase();
  const colors = [...body.matchAll(/#[0-9a-f]{6}\b/giu)].map(([value]) => value.toLowerCase());
  const allowed = normalizedColors(contract.rules.allowedColors);
  const forbidden = normalizedColors(contract.rules.forbiddenColors);
  for (const color of colors) if (!allowed.has(color)) throw new Error(`${label} contains non-approved color ${color}`);
  for (const color of forbidden) if (lower.includes(color)) throw new Error(`${label} contains forbidden color ${color}`);
  if (requireAllColors) {
    for (const color of normalizedColors(contract.rules.requiredColors)) {
      if (!lower.includes(color)) throw new Error(`${label} is missing required color ${color}`);
    }
  }
  for (const family of contract.rules.requiredFontFamilies) {
    if (!lower.includes(family.toLowerCase())) throw new Error(`${label} is missing required font ${family}`);
  }
  if (rejectForbiddenTerms) {
    for (const term of contract.rules.forbiddenVisualTerms) {
      if (lower.includes(term.toLowerCase())) throw new Error(`${label} contains forbidden visual term ${term}`);
    }
  }
  if (contract.rules.requireLogoReference && requireLogo) {
    const referenced = contract.rules.approvedLogoAssets.some(({locator}) => lower.includes(path.basename(locator).toLowerCase()));
    if (!referenced) throw new Error(`${label} does not reference an approved Logo asset`);
  }
}

async function verifyBinding(productionRoot, binding, label) {
  const file = resolveLocator(productionRoot, binding.locator, label);
  await regularFile(file, label);
  if (digest(await readFile(file)) !== binding.sha256) throw new Error(`${label} hash differs from governance binding`);
  return file;
}

async function enumerateTextSource(root, current = root, files = []) {
  for (const entry of (await readdir(current, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
    if (current === root && entry.name === 'node_modules') continue;
    const absolute = path.join(current, entry.name);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error(`governed source contains symlink ${path.relative(root, absolute)}`);
    if (info.isDirectory()) await enumerateTextSource(root, absolute, files);
    else if (info.isFile() && /\.(?:css|html|[cm]?[jt]sx?|json|md)$/iu.test(entry.name)) files.push(absolute);
  }
  return files;
}

export async function finalizeProductionGovernance({productionRoot, draftFile}) {
  const root = path.resolve(productionRoot);
  const draft = await readJson(path.resolve(draftFile), 'production governance draft');
  const contract = {
    ...draft,
    authorities: await Promise.all((draft.authorities ?? []).map((entry, index) => (
      bindDraftFile(root, entry, `authority ${index + 1}`)
    ))),
    originalDesign: await bindDraftFile(root, draft.originalDesign, 'original design'),
    rules: {
      ...draft.rules,
      approvedLogoAssets: await Promise.all((draft.rules?.approvedLogoAssets ?? []).map((entry, index) => (
        bindDraftFile(root, entry, `approved Logo asset ${index + 1}`)
      ))),
    },
  };
  contract.identity = governanceIdentity(contract);
  await assertSchema(contract, 'production-governance.schema.json', 'production governance');
  assertWorkflow(contract);
  const designFile = resolveLocator(root, contract.originalDesign.locator, 'original design');
  assertTextRules(await readFile(designFile, 'utf8'), contract, 'original design', {rejectForbiddenTerms: false});
  const contractFile = path.join(root, GOVERNANCE_CONTRACT_LOCATOR);
  const lockFile = path.join(root, GOVERNANCE_LOCK_LOCATOR);
  await mkdir(path.dirname(contractFile), {recursive: true});
  const body = `${JSON.stringify(contract, null, 2)}\n`;
  await writeFile(contractFile, body, {flag: 'wx'});
  const lock = {
    schemaVersion: '1.0.0', status: 'required',
    contractLocator: GOVERNANCE_CONTRACT_LOCATOR,
    contractSha256: digest(body), contractIdentity: contract.identity,
  };
  lock.identity = governanceIdentity(lock);
  await assertSchema(lock, 'production-governance-lock.schema.json', 'production governance lock');
  await writeFile(lockFile, `${JSON.stringify(lock, null, 2)}\n`, {flag: 'wx'});
  return {status: 'locked', contractFile, lockFile, contract, lock};
}

export async function validateProductionGovernance({
  productionRoot, stage = 'design', visualSystemFile, sourceRoot,
}) {
  const root = path.resolve(productionRoot);
  const lockFile = path.join(root, GOVERNANCE_LOCK_LOCATOR);
  const lock = await readJson(lockFile, 'production governance lock');
  await assertSchema(lock, 'production-governance-lock.schema.json', 'production governance lock');
  if (governanceIdentity(lock) !== lock.identity) throw new Error('production governance lock identity is stale');
  const contractFile = resolveLocator(root, lock.contractLocator, 'production governance contract');
  const contractBody = await readFile(contractFile);
  if (digest(contractBody) !== lock.contractSha256) throw new Error('production governance contract hash differs from lock');
  const contract = JSON.parse(contractBody.toString('utf8'));
  await assertSchema(contract, 'production-governance.schema.json', 'production governance');
  if (governanceIdentity(contract) !== contract.identity || contract.identity !== lock.contractIdentity) {
    throw new Error('production governance contract identity is stale');
  }
  assertWorkflow(contract);
  await Promise.all([
    ...contract.authorities.map((binding, index) => verifyBinding(root, binding, `authority ${index + 1}`)),
    ...contract.rules.approvedLogoAssets.map((binding, index) => verifyBinding(root, binding, `approved Logo asset ${index + 1}`)),
  ]);
  const designFile = await verifyBinding(root, contract.originalDesign, 'original design');
  assertTextRules(await readFile(designFile, 'utf8'), contract, 'original design', {rejectForbiddenTerms: false});
  if (['director', 'source'].includes(stage)) {
    if (!visualSystemFile) throw new Error(`${stage} governance requires visualSystemFile`);
    const visual = await readJson(path.resolve(visualSystemFile), 'Director visual system');
    const body = JSON.stringify({...visual, prohibitedLazyDefaults: []});
    assertTextRules(body, contract, 'Director visual system');
    const prohibited = (visual.prohibitedLazyDefaults ?? []).map((value) => String(value).toLowerCase());
    for (const term of contract.rules.forbiddenVisualTerms) {
      if (!prohibited.some((value) => value.includes(term.toLowerCase()))) {
        throw new Error(`Director visual system prohibitedLazyDefaults is missing ${term}`);
      }
    }
    const palette = normalizedColors((visual.paletteRoles ?? []).map(({value}) => value));
    for (const color of normalizedColors(contract.rules.requiredColors)) {
      if (!palette.has(color)) throw new Error(`Director visual system palette is missing ${color}`);
    }
    const allowedFonts = new Set(contract.rules.allowedFontFamilies.map((value) => value.toLowerCase()));
    for (const role of visual.typographyRoles ?? []) {
      if (!allowedFonts.has(String(role.family).toLowerCase())) {
        throw new Error(`Director visual system uses non-approved font ${role.family}`);
      }
    }
  }
  if (stage === 'source') {
    if (!sourceRoot) throw new Error('source governance requires sourceRoot');
    const files = await enumerateTextSource(path.resolve(sourceRoot));
    if (files.length === 0) throw new Error('governed source has no inspectable production files');
    const body = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
    assertTextRules(body, contract, 'production source');
  }
  return {
    status: 'passed', stage, profileId: contract.profileId,
    contractLocator: lock.contractLocator, contractSha256: lock.contractSha256,
    contractIdentity: contract.identity, lockLocator: GOVERNANCE_LOCK_LOCATOR,
    lockSha256: digest(await readFile(lockFile)), lockIdentity: lock.identity,
  };
}

export async function validateProductionGovernanceIfLocked(options) {
  const lockFile = path.join(path.resolve(options.productionRoot), GOVERNANCE_LOCK_LOCATOR);
  try { await regularFile(lockFile, 'production governance lock'); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  return validateProductionGovernance(options);
}

function parseArgs(argv) {
  const options = {command: argv[0]};
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || !value) throw new Error(`invalid argument ${name ?? ''}`);
    options[name.slice(2)] = value;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options['production-root']) throw new Error('--production-root is required');
  const result = options.command === 'finalize'
    ? await finalizeProductionGovernance({productionRoot: options['production-root'], draftFile: options.draft})
    : options.command === 'validate'
      ? await validateProductionGovernance({
        productionRoot: options['production-root'], stage: options.stage ?? 'design',
        visualSystemFile: options['visual-system'], sourceRoot: options['source-root'],
      })
      : null;
  if (!result) throw new Error('command must be finalize or validate');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
