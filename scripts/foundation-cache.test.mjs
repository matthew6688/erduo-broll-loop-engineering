import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {reuseFoundationAssets} from '../erduo-broll-loop-engineering/scripts/reuse-foundation-assets.mjs';
import {hashFile} from '../erduo-broll-loop-engineering/scripts/shot-media-lib.mjs';

test('Parent reuses only hash-verified fonts and licenses from a frozen asset closure', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'foundation-cache-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const sourceRoot = path.join(root, 'source');
  const targetRoot = path.join(root, 'target');
  const fontLocator = '02-assets/fonts/example/Example.ttf';
  const licenseLocator = '02-assets/licenses/OFL-Example.txt';
  await Promise.all([
    mkdir(path.join(sourceRoot, path.dirname(fontLocator)), {recursive: true}),
    mkdir(path.join(sourceRoot, path.dirname(licenseLocator)), {recursive: true}),
  ]);
  await Promise.all([
    writeFile(path.join(sourceRoot, fontLocator), 'FONT BYTES'),
    writeFile(path.join(sourceRoot, licenseLocator), 'LICENSE BYTES'),
  ]);
  const gate = {
    schemaVersion: '1.0.0', status: 'passed', media: [],
    fonts: [{locator: fontLocator, sha256: await hashFile(path.join(sourceRoot, fontLocator)), bytes: 10}],
    licenses: [{locator: licenseLocator, sha256: await hashFile(path.join(sourceRoot, licenseLocator)), bytes: 13}],
  };
  const gateFile = path.join(sourceRoot, '02-assets/gates/assets-gate.json');
  await mkdir(path.dirname(gateFile), {recursive: true});
  await writeFile(gateFile, `${JSON.stringify(gate)}\n`);

  const result = await reuseFoundationAssets({sourceProductionRoot: sourceRoot, targetProductionRoot: targetRoot});
  assert.equal(result.status, 'reused');
  assert.equal(result.files, 2);
  assert.equal(await readFile(path.join(targetRoot, fontLocator), 'utf8'), 'FONT BYTES');
  assert.equal(await readFile(path.join(targetRoot, licenseLocator), 'utf8'), 'LICENSE BYTES');
  const receipt = JSON.parse(await readFile(path.join(targetRoot, '02-assets/gates/foundation-reuse.json'), 'utf8'));
  assert.deepEqual(receipt.files.map(({locator}) => locator), [fontLocator, licenseLocator]);

  await writeFile(path.join(sourceRoot, fontLocator), 'TAMPERED');
  await assert.rejects(
    reuseFoundationAssets({sourceProductionRoot: sourceRoot, targetProductionRoot: path.join(root, 'bad-target')}),
    /hash mismatch/u,
  );
});
