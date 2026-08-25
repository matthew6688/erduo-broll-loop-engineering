import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  computeMaterialPolicyIdentity,
  verifyMaterialPolicy,
} from '../erduo-broll-loop-engineering/scripts/material-policy.mjs';
import {createHash} from 'node:crypto';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'material-policy-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const inputs = path.join(root, '00-inputs');
  await mkdir(inputs, {recursive: true});
  const originalDesignFile = path.join(inputs, 'original-design.md');
  await writeFile(originalDesignFile, '# Default Design\n');
  const originalDesignSha256 = createHash('sha256').update(await readFile(originalDesignFile)).digest('hex');
  const policy = {
    schemaVersion: '1.0.0', status: 'approved', approvedBy: 'user',
    scope: 'default-design-native-only', minimumMaterialShots: 0,
    reason: 'The user requires the unchanged default design and native graphics only.',
    originalDesignSha256, identity: '',
  };
  policy.identity = computeMaterialPolicyIdentity(policy);
  const materialPolicyFile = path.join(inputs, 'material-policy.json');
  await writeFile(materialPolicyFile, `${JSON.stringify(policy, null, 2)}\n`);
  return {root, originalDesignFile, materialPolicyFile, policy};
}

test('material policy is user-approved, identity-bound, and bound to the exact original design', async (t) => {
  const value = await fixture(t);
  const binding = await verifyMaterialPolicy({
    productionRoot: value.root,
    materialPolicyFile: value.materialPolicyFile,
    originalDesignFile: value.originalDesignFile,
  });
  assert.equal(binding.identity, value.policy.identity);
  assert.equal(binding.minimumMaterialShots, 0);

  await writeFile(value.originalDesignFile, '# Changed Design\n');
  await assert.rejects(verifyMaterialPolicy({
    productionRoot: value.root,
    materialPolicyFile: value.materialPolicyFile,
    originalDesignFile: value.originalDesignFile,
  }), /not approved for the bound original design/iu);
});

test('material policy rejects hand-edited approval content and noncanonical locators', async (t) => {
  const value = await fixture(t);
  const edited = JSON.parse(await readFile(value.materialPolicyFile, 'utf8'));
  edited.reason = 'Hand edited after approval and identity creation.';
  await writeFile(value.materialPolicyFile, `${JSON.stringify(edited)}\n`);
  await assert.rejects(verifyMaterialPolicy({
    productionRoot: value.root,
    materialPolicyFile: value.materialPolicyFile,
    originalDesignFile: value.originalDesignFile,
  }), /identity does not match/iu);

  const wrong = path.join(value.root, 'material-policy.json');
  await writeFile(wrong, `${JSON.stringify(value.policy)}\n`);
  await assert.rejects(verifyMaterialPolicy({
    productionRoot: value.root, materialPolicyFile: wrong,
    originalDesignFile: value.originalDesignFile,
  }), /locator must be 00-inputs\/material-policy.json/iu);
});
