import {createHash} from 'node:crypto';
import {lstat, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {canonicalJson, validateSchemaValue} from './runtime-schema-validator.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaFile = path.join(skillRoot, 'references', 'runtime', 'material-policy.schema.json');
const expectedLocator = '00-inputs/material-policy.json';

export function computeMaterialPolicyIdentity(value) {
  const {identity: _identity, ...content} = value;
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

function withinProductionRoot(productionRoot, file, label) {
  const root = path.resolve(productionRoot);
  const absolute = path.resolve(file);
  const locator = path.relative(root, absolute).split(path.sep).join('/');
  if (!locator || locator.startsWith('../') || path.isAbsolute(locator)) {
    throw new Error(`${label} must be inside the production root`);
  }
  return {absolute, locator};
}

export async function verifyMaterialPolicy({productionRoot, materialPolicyFile, originalDesignFile}) {
  if (!productionRoot || !materialPolicyFile || !originalDesignFile) {
    throw new Error('material policy, original design, and production root are required together');
  }
  const policyRecord = withinProductionRoot(productionRoot, materialPolicyFile, 'material policy');
  if (policyRecord.locator !== expectedLocator) {
    throw new Error(`material policy locator must be ${expectedLocator}`);
  }
  const [policyInfo, policyBody, designInfo, designBody, schema] = await Promise.all([
    lstat(policyRecord.absolute), readFile(policyRecord.absolute),
    lstat(path.resolve(originalDesignFile)), readFile(path.resolve(originalDesignFile)),
    readFile(schemaFile, 'utf8').then(JSON.parse),
  ]);
  if (!policyInfo.isFile() || policyInfo.isSymbolicLink()) throw new Error('material policy must be a real JSON file');
  if (!designInfo.isFile() || designInfo.isSymbolicLink()) throw new Error('original design must be a real file');
  let value;
  try { value = JSON.parse(policyBody.toString('utf8')); } catch { throw new Error('material policy is invalid JSON'); }
  const errors = validateSchemaValue(value, schema, schema);
  if (errors.length) throw new Error(`material policy schema validation failed:\n${errors.join('\n')}`);
  if (computeMaterialPolicyIdentity(value) !== value.identity) {
    throw new Error('material policy identity does not match its contents');
  }
  const designSha256 = createHash('sha256').update(designBody).digest('hex');
  if (value.originalDesignSha256 !== designSha256) {
    throw new Error('material policy is not approved for the bound original design');
  }
  return {
    locator: expectedLocator,
    sha256: createHash('sha256').update(policyBody).digest('hex'),
    identity: value.identity,
    approvedBy: value.approvedBy,
    scope: value.scope,
    minimumMaterialShots: value.minimumMaterialShots,
    originalDesignSha256: value.originalDesignSha256,
  };
}
