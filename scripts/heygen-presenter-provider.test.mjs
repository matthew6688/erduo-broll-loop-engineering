import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { generateHeygenPresenter } from '../erduo-broll-loop-engineering/scripts/generate-heygen-presenter.mjs';

const ACCOUNT_URL = ['https://api.heygen.com/v3', 'users', 'me'].join('/');

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } });
}

test('HeyGen provider persists ids, downloads once, and resumes without storing the API key', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'heygen-provider-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '00-inputs', 'presenter'), { recursive: true });
  await mkdir(path.join(root, 'work'), { recursive: true });
  const portrait = path.join(root, '00-inputs', 'presenter', 'portrait.png');
  const narration = path.join(root, '00-inputs', 'presenter', 'narration.wav');
  const authorization = path.join(root, '00-inputs', 'presenter', 'authorization.json');
  const output = path.join(root, '00-inputs', 'presenter', 'presenter.mp4');
  const state = path.join(root, 'work', 'heygen-state.json');
  await Promise.all([
    writeFile(portrait, 'PORTRAIT'), writeFile(narration, 'NARRATION'),
    writeFile(authorization, `${JSON.stringify({
      schemaVersion: '1.0.0', provider: 'heygen', scope: 'canary',
      likeness: 'user-confirmed-self', voice: 'user-confirmed-self', approvedBy: 'user',
    })}\n`),
  ]);
  const calls = [];
  let assets = 0;
  let polls = 0;
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET', headers: options.headers ?? {} });
    if (url === ACCOUNT_URL) return jsonResponse({ wallet: { remaining_balance: 10 } });
    if (url.endsWith('/v3/assets')) { assets += 1; return jsonResponse({ id: `asset-${assets}` }); }
    if (url.endsWith('/v3/videos') && options.method === 'POST') return jsonResponse({ video_id: 'video-1', status: 'waiting' });
    if (url.endsWith('/v3/videos/video-1')) {
      polls += 1;
      return jsonResponse(polls === 1
        ? { status: 'processing' }
        : { status: 'completed', video_url: 'https://download.test/video.mp4' });
    }
    if (url === 'https://download.test/video.mp4') return new Response(Buffer.from('VIDEO'), { status: 200 });
    throw new Error(`unexpected URL ${url}`);
  };
  const first = await generateHeygenPresenter({
    productionRoot: root, portraitFile: portrait, narrationFile: narration,
    authorizationFile: authorization, outputFile: output, stateFile: state,
    authValue: 'secret-test-key', fetchImpl: fakeFetch, sleep: async () => {}, pollIntervalMs: 0,
    durationSeconds: 15.94,
  });
  assert.equal(first.resumed, false);
  assert.equal(await readFile(output, 'utf8'), 'VIDEO');
  const saved = JSON.parse(await readFile(state, 'utf8'));
  assert.equal(saved.videoId, 'video-1');
  assert.equal(saved.status, 'downloaded');
  assert.equal(saved.walletBeforeCredits, 10);
  assert.equal(saved.estimatedCostCredits, 1.594);
  assert.equal(saved.walletBeforeUsd, undefined);
  assert.equal(saved.estimatedCostUsd, undefined);
  assert.equal(JSON.stringify(saved).includes('secret-test-key'), false);
  assert.equal(calls.filter(({ url }) => url.endsWith('/v3/videos')).length, 1);
  const callCount = calls.length;
  const second = await generateHeygenPresenter({
    productionRoot: root, portraitFile: portrait, narrationFile: narration,
    authorizationFile: authorization, outputFile: output, stateFile: state,
    authValue: 'secret-test-key', fetchImpl: fakeFetch, sleep: async () => {}, pollIntervalMs: 0,
    durationSeconds: 15.94,
  });
  assert.equal(second.resumed, true);
  assert.equal(calls.length, callCount);
});

test('HeyGen provider interprets the v3 balance as credits and refuses before uploading', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'heygen-provider-balance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '00-inputs', 'presenter'), { recursive: true });
  await mkdir(path.join(root, 'work'), { recursive: true });
  const portrait = path.join(root, '00-inputs', 'presenter', 'portrait.png');
  const narration = path.join(root, '00-inputs', 'presenter', 'narration.wav');
  const authorization = path.join(root, '00-inputs', 'presenter', 'authorization.json');
  const state = path.join(root, 'work', 'heygen-state.json');
  await Promise.all([
    writeFile(portrait, 'PORTRAIT'), writeFile(narration, 'NARRATION'),
    writeFile(authorization, `${JSON.stringify({
      schemaVersion: '1.0.0', provider: 'heygen', scope: 'canary',
      likeness: 'user-confirmed-self', voice: 'user-confirmed-self', approvedBy: 'user',
    })}\n`),
  ]);
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(String(url));
    if (url === ACCOUNT_URL) return jsonResponse({ wallet: { remaining_balance: 0.2 } });
    throw new Error(`unexpected URL ${url}`);
  };
  await assert.rejects(() => generateHeygenPresenter({
    productionRoot: root, portraitFile: portrait, narrationFile: narration,
    authorizationFile: authorization,
    outputFile: path.join(root, '00-inputs', 'presenter', 'presenter.mp4'), stateFile: state,
    authValue: 'secret-test-key', fetchImpl: fakeFetch, durationSeconds: 15.94,
  }), /0\.20 credits is below estimated 1\.59 credits/);
  assert.deepEqual(calls, [ACCOUNT_URL]);
  const saved = JSON.parse(await readFile(state, 'utf8'));
  assert.equal(saved.walletBeforeCredits, 0.2);
  assert.equal(saved.estimatedCostCredits, 1.594);
  assert.equal(saved.videoId, undefined);
});
