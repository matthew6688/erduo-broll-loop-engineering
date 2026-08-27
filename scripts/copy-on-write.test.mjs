import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  cloneFile, cloneTree, deduplicateTree,
} from '../erduo-broll-loop-engineering/scripts/copy-on-write.mjs';

test('clone helpers preserve independent file semantics and deduplicate only exact bytes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copy-on-write-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const source = path.join(root, 'source.bin');
  const clone = path.join(root, 'clone.bin');
  const different = path.join(root, 'different.bin');
  const body = Buffer.alloc(2 * 1024 * 1024, 7);
  await writeFile(source, body);
  await cloneFile(source, clone, {exclusive: true});
  await writeFile(different, Buffer.alloc(body.length, 8));
  assert.deepEqual(await readFile(clone), body);
  assert.notEqual((await stat(source)).ino, (await stat(clone)).ino);

  const tree = path.join(root, 'tree');
  await mkdir(path.join(tree, 'nested'), {recursive: true});
  await writeFile(path.join(tree, 'nested', 'asset.bin'), body);
  await cloneTree(tree, path.join(root, 'tree-clone'));
  assert.deepEqual(await readFile(path.join(root, 'tree-clone', 'nested', 'asset.bin')), body);

  const preview = await deduplicateTree({root, minBytes: 1024 * 1024});
  assert.equal(preview.status, 'preview');
  assert.equal(preview.duplicateFiles, 3);
  assert.equal(preview.clonedFiles, 0);
  const applied = await deduplicateTree({root, minBytes: 1024 * 1024, apply: true});
  assert.equal(applied.status, 'applied');
  assert.equal(applied.clonedFiles, 3);
  await writeFile(clone, Buffer.alloc(body.length, 9));
  assert.deepEqual(await readFile(source), body);
  assert.deepEqual(await readFile(different), Buffer.alloc(body.length, 8));
});
