#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isDirectExecution } from './direct-execution.mjs';
import { parseCliPairs, resolveExistingRegularWithinRoot, resolveNewOutputWithinRoot } from './presenter-media-lib.mjs';
import {runTimedProductionStage} from './record-production-event.mjs';

const BASE_URL = 'https://api.heygen.com';
const CURRENT_ACCOUNT_RESOURCE = ['v3', 'users', 'me'].join('/');

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function hashFile(file) {
  return digest(await readFile(file));
}

async function readJson(file, label) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new Error(`${label} is invalid JSON`); }
}

async function exists(file) {
  try { return (await lstat(file)).isFile(); }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function atomicJson(file, value) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temporary, file);
}

async function responseData(response, label) {
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error(`${label} returned HTTP ${response.status} with invalid JSON`); }
  if (!response.ok || payload?.error) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${JSON.stringify(payload?.error ?? payload?.message ?? payload)}`);
  }
  return payload.data;
}

async function uploadAsset({ file, authValue, fetchImpl }) {
  const form = new FormData();
  form.append('file', new Blob([await readFile(file)]), path.basename(file));
  return responseData(await fetchImpl(`${BASE_URL}/v3/assets`, {
    method: 'POST', headers: { 'x-api-key': authValue }, body: form,
  }), 'HeyGen asset upload').then((data) => {
    const id = data?.id ?? data?.asset_id;
    if (!id) throw new Error('HeyGen asset upload returned no asset id');
    return id;
  });
}

function validateAuthorization(value) {
  const expected = {
    schemaVersion: '1.0.0', provider: 'heygen', scope: 'canary',
    likeness: 'user-confirmed-self', voice: 'user-confirmed-self', approvedBy: 'user',
  };
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new Error('HeyGen canary authorization is missing or changed');
  }
}

export async function generateHeygenPresenter({
  productionRoot, portraitFile, narrationFile, authorizationFile, outputFile, stateFile,
  aspectRatio = '16:9', resolution = '1080p', title = 'FengTalk presenter canary',
  motionPrompt, expressiveness = 'low', authValue = process.env['HEYGEN_API_KEY'],
  fetchImpl = fetch, sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  pollIntervalMs = 10_000, pollLimit = 180, creditsPerSecond = 0.1, durationSeconds,
}) {
  if (!authValue) throw new Error('HEYGEN_API_KEY is required and is never stored');
  if (!['16:9', '9:16'].includes(aspectRatio)) throw new Error('aspectRatio must be 16:9 or 9:16');
  if (!['720p', '1080p', '4k'].includes(resolution)) throw new Error('resolution must be 720p, 1080p, or 4k');
  if (!['low', 'medium', 'high'].includes(expressiveness)) throw new Error('expressiveness must be low, medium, or high');
  if (!Number.isFinite(Number(durationSeconds)) || Number(durationSeconds) <= 0) {
    throw new Error('durationSeconds must be a positive measured narration duration');
  }
  const [portrait, narration, authorization] = await Promise.all([
    resolveExistingRegularWithinRoot(productionRoot, portraitFile, 'HeyGen portrait'),
    resolveExistingRegularWithinRoot(productionRoot, narrationFile, 'HeyGen narration'),
    resolveExistingRegularWithinRoot(productionRoot, authorizationFile, 'HeyGen authorization'),
  ]);
  validateAuthorization(await readJson(authorization.absolute, 'HeyGen authorization'));
  const outputCandidate = path.isAbsolute(outputFile) ? outputFile : path.resolve(productionRoot, outputFile);
  const stateCandidate = path.isAbsolute(stateFile) ? stateFile : path.resolve(productionRoot, stateFile);
  const outputExists = await exists(outputCandidate);
  const output = outputExists
    ? await resolveExistingRegularWithinRoot(productionRoot, outputFile, 'HeyGen output')
    : await resolveNewOutputWithinRoot(productionRoot, outputFile, 'HeyGen output');
  const stateExists = await exists(stateCandidate);
  const stateRecord = stateExists
    ? await resolveExistingRegularWithinRoot(productionRoot, stateFile, 'HeyGen state')
    : await resolveNewOutputWithinRoot(productionRoot, stateFile, 'HeyGen state');
  const inputIdentity = {
    portraitSha256: await hashFile(portrait.absolute), narrationSha256: await hashFile(narration.absolute),
    authorizationSha256: await hashFile(authorization.absolute), aspectRatio, resolution,
    motionPrompt: motionPrompt ?? null, expressiveness, durationSeconds: Number(durationSeconds),
  };
  const state = stateExists ? await readJson(stateRecord.absolute, 'HeyGen state') : {
    schemaVersion: '1.0.0', provider: 'heygen', inputIdentity,
    idempotencyKey: randomUUID(), status: 'prepared',
  };
  if (JSON.stringify(state.inputIdentity) !== JSON.stringify(inputIdentity)) {
    throw new Error('HeyGen inputs changed after task preparation');
  }
  if (outputExists) {
    const outputSha256 = await hashFile(output.absolute);
    if (state.status !== 'downloaded' || state.outputSha256 !== outputSha256) {
      throw new Error('existing HeyGen output is not bound to the saved provider state');
    }
    return { status: 'heygen-presenter-ready', output: output.absolute, state: stateRecord.absolute, resumed: true };
  }
  if (!stateExists) await atomicJson(stateRecord.absolute, state);
  const headers = { 'x-api-key': authValue };
  if (state.status === 'failed') throw new Error(`HeyGen task already failed: ${state.failureMessage ?? 'unknown'}`);
  if (state.walletBeforeCredits === undefined) {
    const user = await responseData(await fetchImpl(`${BASE_URL}/${CURRENT_ACCOUNT_RESOURCE}`, { headers }), 'HeyGen user');
    state.walletBeforeCredits = Number(user?.wallet?.remaining_balance ?? 0);
    state.estimatedCostCredits = Number((Number(durationSeconds) * creditsPerSecond).toFixed(4));
    await atomicJson(stateRecord.absolute, state);
  }
  if (state.walletBeforeCredits + 1e-9 < state.estimatedCostCredits) {
    throw new Error(`HeyGen API balance ${state.walletBeforeCredits.toFixed(2)} credits is below estimated ${state.estimatedCostCredits.toFixed(2)} credits`);
  }
  if (!state.portraitAssetId) {
    state.portraitAssetId = await uploadAsset({ file: portrait.absolute, authValue, fetchImpl });
    await atomicJson(stateRecord.absolute, state);
  }
  if (!state.audioAssetId) {
    state.audioAssetId = await uploadAsset({ file: narration.absolute, authValue, fetchImpl });
    await atomicJson(stateRecord.absolute, state);
  }
  if (!state.videoId) {
    state.status = 'submitting';
    await atomicJson(stateRecord.absolute, state);
    const body = {
      type: 'image', image: { type: 'asset_id', asset_id: state.portraitAssetId },
      audio_asset_id: state.audioAssetId, title, aspect_ratio: aspectRatio,
      resolution, output_format: 'mp4', expressiveness,
      ...(motionPrompt ? { motion_prompt: motionPrompt } : {}),
    };
    const created = await responseData(await fetchImpl(`${BASE_URL}/v3/videos`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': state.idempotencyKey },
      body: JSON.stringify(body),
    }), 'HeyGen video creation');
    state.videoId = created.video_id;
    state.status = created.status ?? 'submitted';
    await atomicJson(stateRecord.absolute, state);
  }
  let completed;
  for (let attempt = 0; attempt < pollLimit; attempt += 1) {
    const current = await responseData(await fetchImpl(`${BASE_URL}/v3/videos/${state.videoId}`, { headers }), 'HeyGen video status');
    state.status = current.status;
    if (current.status === 'failed') state.failureMessage = current.failure_message ?? 'unknown';
    await atomicJson(stateRecord.absolute, state);
    if (current.status === 'failed') throw new Error(`HeyGen video failed: ${state.failureMessage}`);
    if (current.status === 'completed') { completed = current; break; }
    await sleep(pollIntervalMs);
  }
  if (!completed) throw new Error('HeyGen polling timed out; resume the saved videoId instead of resubmitting');
  const media = await fetchImpl(completed.video_url);
  if (!media.ok) throw new Error(`HeyGen video download failed with HTTP ${media.status}`);
  const temporary = path.join(path.dirname(output.absolute), `.${path.basename(output.absolute)}.${randomUUID()}.tmp`);
  await writeFile(temporary, Buffer.from(await media.arrayBuffer()), { flag: 'wx' });
  await rename(temporary, output.absolute);
  state.outputSha256 = await hashFile(output.absolute);
  state.status = 'downloaded';
  await atomicJson(stateRecord.absolute, state);
  return { status: 'heygen-presenter-ready', output: output.absolute, state: stateRecord.absolute, resumed: false };
}

async function main() {
  const options = parseCliPairs(process.argv.slice(2));
  if (!options['production-root']) throw new Error('--production-root is required');
  const result = await runTimedProductionStage({
    eventsFile: path.join(path.resolve(options['production-root']), 'production-events.ndjson'),
    stage: 'assembly', phase: 'presenter-generation',
  }, () => generateHeygenPresenter({
      productionRoot: options['production-root'], portraitFile: options.portrait,
      narrationFile: options.narration, authorizationFile: options.authorization,
      outputFile: options.output, stateFile: options.state, aspectRatio: options['aspect-ratio'],
      resolution: options.resolution, title: options.title, motionPrompt: options['motion-prompt'],
      expressiveness: options.expressiveness, durationSeconds: Number(options['duration-seconds']),
    }));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
