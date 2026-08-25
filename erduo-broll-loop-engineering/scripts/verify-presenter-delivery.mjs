#!/usr/bin/env node

import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {probeAudioVisual} from './create-presenter-source.mjs';
import {validateSchemaValue} from './runtime-schema-validator.mjs';
import {commandFailure, hashFile, readJson, runCommand} from './shot-media-lib.mjs';
import {
  parseCliPairs, resolveExistingRegularWithinRoot, resolveNewOutputWithinRoot,
} from './presenter-media-lib.mjs';
import {verifyVideoSkillUsage} from './skill-usage.mjs';
import {computeRuntimePlanIdentity} from './validate-runtime-plan.mjs';
import {isDirectExecution} from './direct-execution.mjs';

const schemas = path.resolve(import.meta.dirname, '..', 'references', 'runtime');

function parseClock(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/u.exec(value.trim());
  if (!match) throw new Error(`invalid SRT timestamp: ${value}`);
  const [, hours, minutes, seconds, milliseconds] = match.map(Number);
  if (minutes > 59 || seconds > 59) throw new Error(`invalid SRT timestamp: ${value}`);
  return (((hours * 60 + minutes) * 60) + seconds) * 1000 + milliseconds;
}

export function parseSrtCues(text) {
  const normalized = String(text).replace(/\r\n?/gu, '\n').trim();
  if (!normalized) throw new Error('subtitle SRT is empty');
  const cues = normalized.split(/\n{2,}/u).map((block, index) => {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) throw new Error(`subtitle cue ${index + 1} has no timing line`);
    const timing = /^\s*(\S+)\s+-->\s+(\S+)\s*$/u.exec(lines[timingIndex]);
    if (!timing) throw new Error(`subtitle cue ${index + 1} has an invalid timing line`);
    const startMs = parseClock(timing[1]);
    const endMs = parseClock(timing[2]);
    const content = lines.slice(timingIndex + 1).join('\n').trim();
    if (!content) throw new Error(`subtitle cue ${index + 1} has no text`);
    if (endMs <= startMs) throw new Error(`subtitle cue ${index + 1} has a non-positive window`);
    return {startMs, endMs, content};
  });
  for (let index = 1; index < cues.length; index += 1) {
    if (cues[index].startMs < cues[index - 1].endMs) {
      throw new Error(`subtitle cue ${index + 1} overlaps the preceding cue`);
    }
  }
  return cues;
}

export function parseVolumeDetect(stderr) {
  const mean = /mean_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/iu.exec(stderr)?.[1];
  const peak = /max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/iu.exec(stderr)?.[1];
  if (mean === undefined || peak === undefined) throw new Error('volumedetect did not report mean and max volume');
  return {meanVolumeDb: Number(mean), maxVolumeDb: Number(peak)};
}

async function defaultMeasureAudio(file, {ffmpeg = 'ffmpeg', runner = runCommand} = {}) {
  const result = await runner({
    executable: ffmpeg,
    args: ['-v', 'info', '-nostdin', '-i', file, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'],
    cwd: path.dirname(file),
  });
  if (result.code !== 0) throw commandFailure('final delivery audio measurement', result);
  return parseVolumeDetect(result.stderr);
}

async function defaultFingerprintAudio(file, {ffmpeg = 'ffmpeg', runner = runCommand} = {}) {
  const result = await runner({
    executable: ffmpeg,
    args: ['-v', 'error', '-nostdin', '-i', file, '-map', '0:a:0', '-f', 'hash', '-hash', 'sha256', '-'],
    cwd: path.dirname(file),
  });
  if (result.code !== 0) throw commandFailure('final delivery decoded-audio fingerprint', result);
  const match = /SHA256=([0-9a-f]{64})/iu.exec(result.stdout);
  if (!match) throw new Error('decoded-audio fingerprint did not return SHA-256');
  return match[1].toLowerCase();
}

async function assertSchema(value, name, label) {
  const schema = await readJson(path.join(schemas, name), `${label} schema`);
  const errors = validateSchemaValue(value, schema, schema);
  if (errors.length) throw new Error(`${label} failed schema validation:\n- ${errors.join('\n- ')}`);
}

function sameMediaFacts(facts, expected, toleranceMs) {
  return facts.videoCodec === expected.codec && facts.width === expected.width && facts.height === expected.height
    && Math.abs(facts.fps - expected.fps) <= 1e-6
    && Math.abs(facts.durationMs - expected.durationMs) <= toleranceMs;
}

export async function verifyPresenterDelivery({
  productionRoot,
  finalMediaFile,
  subtitleFile,
  compositionReceiptFile,
  editPlanFile,
  outputFile,
  minMeanVolumeDb = -30,
  minMaxVolumeDb = -6,
  ffmpeg = 'ffmpeg',
  ffprobe = 'ffprobe',
  runner = runCommand,
  probeMedia = probeAudioVisual,
  measureAudio = defaultMeasureAudio,
  fingerprintAudio = defaultFingerprintAudio,
  writeReceipt = true,
}) {
  if (!productionRoot || !finalMediaFile || !subtitleFile) {
    throw new Error('presenter delivery gate requires productionRoot, finalMediaFile, and subtitleFile');
  }
  const root = path.resolve(productionRoot);
  compositionReceiptFile ??= path.join(root, '05-delivery', 'presenter-broll-master.receipt.json');
  editPlanFile ??= path.join(root, '01-runtime-plan', 'presenter-edit-plan.json');
  outputFile ??= path.join(root, '05-delivery', 'presenter-delivery-gate.json');
  if (!Number.isFinite(minMeanVolumeDb) || !Number.isFinite(minMaxVolumeDb)) {
    throw new Error('presenter delivery loudness thresholds must be finite numbers');
  }
  const [finalMedia, subtitle, compositionReceipt, editPlan] = await Promise.all([
    resolveExistingRegularWithinRoot(root, finalMediaFile, 'final presenter delivery'),
    resolveExistingRegularWithinRoot(root, subtitleFile, 'final subtitle SRT'),
    resolveExistingRegularWithinRoot(root, compositionReceiptFile, 'presenter composition receipt'),
    resolveExistingRegularWithinRoot(root, editPlanFile, 'presenter edit plan'),
  ]);
  const [receipt, plan] = await Promise.all([
    readJson(compositionReceipt.absolute, 'presenter composition receipt'),
    readJson(editPlan.absolute, 'presenter edit plan'),
  ]);
  await assertSchema(receipt, 'presenter-composition-receipt.schema.json', 'presenter composition receipt');
  if (await hashFile(editPlan.absolute) !== receipt.inputs.editPlanSha256) {
    throw new Error('presenter edit plan changed after composition');
  }
  const runtimePlan = await resolveExistingRegularWithinRoot(root, plan.runtimePlan?.file, 'bound runtime plan');
  if (await hashFile(runtimePlan.absolute) !== plan.runtimePlan.sha256) throw new Error('runtime plan changed after edit-plan compilation');
  const runtime = await readJson(runtimePlan.absolute, 'bound runtime plan');
  if (runtime.identity !== plan.runtimePlan.identity || computeRuntimePlanIdentity(runtime) !== runtime.identity) {
    throw new Error('runtime plan identity changed after edit-plan compilation');
  }
  if (!runtime.sourceContext?.skillUsage) throw new Error('final delivery requires runtime-plan skill usage binding');
  await verifyVideoSkillUsage({
    productionRoot: root, videoFile: finalMedia.absolute, planIdentity: runtime.identity,
    binding: runtime.sourceContext.skillUsage,
  });
  const originalSrt = await resolveExistingRegularWithinRoot(root, runtime.sourceContext?.originalSrt?.locator, 'bound original SRT');
  const originalSrtSha256 = await hashFile(originalSrt.absolute);
  if (originalSrtSha256 !== runtime.sourceContext.originalSrt.sha256) throw new Error('original SRT changed after runtime planning');
  const subtitleSha256 = await hashFile(subtitle.absolute);
  if (subtitleSha256 !== originalSrtSha256) throw new Error('final subtitle SRT must be byte-identical to the bound original SRT');

  const deliveryRoot = path.dirname(compositionReceipt.absolute);
  const baseComposition = await resolveExistingRegularWithinRoot(deliveryRoot, receipt.output.file, 'bound presenter composition');
  if (await hashFile(baseComposition.absolute) !== receipt.output.sha256) throw new Error('presenter composition changed after receipt creation');
  const [facts, finalAudioSha256, baseAudioSha256, audio] = await Promise.all([
    probeMedia(finalMedia.absolute, {ffmpeg, ffprobe, runner, label: 'final presenter delivery'}),
    fingerprintAudio(finalMedia.absolute, {ffmpeg, runner}),
    fingerprintAudio(baseComposition.absolute, {ffmpeg, runner}),
    measureAudio(finalMedia.absolute, {ffmpeg, runner}),
  ]);
  const frameToleranceMs = 1000 / receipt.output.fps + 1;
  if (!sameMediaFacts(facts, receipt.output, frameToleranceMs) || facts.audioStreams !== 1
    || facts.audioCodec !== 'aac' || facts.sampleRate !== 48000) {
    throw new Error('final presenter delivery media facts differ from the approved composition');
  }
  if (finalAudioSha256 !== baseAudioSha256) {
    throw new Error('final subtitle delivery does not preserve the approved composition audio');
  }
  if (!Number.isFinite(audio.meanVolumeDb) || audio.meanVolumeDb < minMeanVolumeDb) {
    throw new Error(`final delivery mean volume ${audio.meanVolumeDb} dB is below ${minMeanVolumeDb} dB`);
  }
  if (!Number.isFinite(audio.maxVolumeDb) || audio.maxVolumeDb < minMaxVolumeDb || audio.maxVolumeDb > 0.1) {
    throw new Error(`final delivery max volume ${audio.maxVolumeDb} dB is outside ${minMaxVolumeDb}..0.1 dB`);
  }
  const cues = parseSrtCues(await readFile(subtitle.absolute, 'utf8'));
  if (cues.at(-1).endMs > facts.durationMs + frameToleranceMs) throw new Error('final subtitle extends beyond the final media duration');

  const value = {
    schemaVersion: '1.0.0', status: 'passed', presenterKind: receipt.presenterKind,
    inputs: {
      compositionReceiptSha256: await hashFile(compositionReceipt.absolute),
      editPlanSha256: receipt.inputs.editPlanSha256,
      runtimePlanSha256: await hashFile(runtimePlan.absolute),
      originalSrtSha256, subtitleSha256, finalMediaSha256: await hashFile(finalMedia.absolute),
    },
    timeline: {...receipt.mix},
    output: {
      file: finalMedia.locator, durationMs: facts.durationMs, width: facts.width, height: facts.height,
      fps: facts.fps, videoCodec: facts.videoCodec, audioCodec: facts.audioCodec,
      sampleRate: facts.sampleRate, channels: facts.channels, audioStreams: facts.audioStreams,
      fullDecode: 'passed',
    },
    audio: {
      decodedPcmSha256: finalAudioSha256, meanVolumeDb: audio.meanVolumeDb,
      maxVolumeDb: audio.maxVolumeDb, minMeanVolumeDb, minMaxVolumeDb,
    },
    subtitles: {
      cueCount: cues.length, startMs: cues[0].startMs, endMs: cues.at(-1).endMs,
      exactOriginalSrt: true,
    },
    checks: {
      compositionBinding: 'passed', runtimeBinding: 'passed', sourceSrtBinding: 'passed',
      oneAudioStream: 'passed', audioContinuity: 'passed', loudness: 'passed',
      subtitleTiming: 'passed', fullDecode: 'passed',
    },
  };
  await assertSchema(value, 'presenter-delivery-gate.schema.json', 'presenter delivery gate');
  if (writeReceipt) {
    const output = await resolveNewOutputWithinRoot(root, outputFile, 'presenter delivery gate output');
    await writeFile(output.absolute, `${JSON.stringify(value, null, 2)}\n`, {flag: 'wx'});
    return {status: 'presenter-delivery-passed', output: output.absolute, gate: value};
  }
  return {status: 'presenter-delivery-passed', output: null, gate: value};
}

async function main() {
  const options = parseCliPairs(process.argv.slice(2));
  const result = await verifyPresenterDelivery({
    productionRoot: options['production-root'], finalMediaFile: options.final,
    subtitleFile: options.subtitle, compositionReceiptFile: options['composition-receipt'],
    editPlanFile: options['edit-plan'], outputFile: options.output,
    minMeanVolumeDb: options['min-mean-volume-db'] === undefined ? -30 : Number(options['min-mean-volume-db']),
    minMaxVolumeDb: options['min-max-volume-db'] === undefined ? -6 : Number(options['min-max-volume-db']),
    ffmpeg: options.ffmpeg, ffprobe: options.ffprobe,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => {process.stderr.write(`${error.message}\n`); process.exitCode = 1;});
}
