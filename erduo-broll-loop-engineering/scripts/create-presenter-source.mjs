#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSchemaValue } from './runtime-schema-validator.mjs';
import { commandFailure, hashFile, readJson, requireRegularFile, runCommand } from './shot-media-lib.mjs';
import { parseCliPairs, resolveExistingRegularWithinRoot, resolveNewOutputWithinRoot } from './presenter-media-lib.mjs';

const schemaFile = path.resolve(import.meta.dirname, '..', 'references', 'runtime', 'presenter-source.schema.json');

export async function probeAudioVisual(file, {
  ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', runner = runCommand, cwd = path.dirname(file), label = 'presenter media',
} = {}) {
  const probe = await runner({
    executable: ffprobe,
    args: ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file],
    cwd,
  });
  if (probe.code !== 0) throw commandFailure(`${label} FFprobe`, probe);
  let value;
  try { value = JSON.parse(probe.stdout); } catch { throw new Error(`${label} FFprobe returned invalid JSON`); }
  const videos = (value.streams ?? []).filter(({ codec_type: type }) => type === 'video');
  const audios = (value.streams ?? []).filter(({ codec_type: type }) => type === 'audio');
  if (videos.length !== 1) throw new Error(`${label} must contain exactly one video stream`);
  if (audios.length !== 1) throw new Error(`${label} must contain exactly one audio stream`);
  const decode = await runner({
    executable: ffmpeg,
    args: ['-v', 'error', '-nostdin', '-xerror', '-i', file, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'],
    cwd,
  });
  if (decode.code !== 0) throw commandFailure(`${label} full audiovisual decode`, decode);
  const video = videos[0];
  const audio = audios[0];
  const fpsText = video.avg_frame_rate ?? video.r_frame_rate;
  const match = /^([0-9]+)\/([1-9][0-9]*)$/u.exec(String(fpsText ?? ''));
  const fps = match ? Number(match[1]) / Number(match[2]) : Number(fpsText);
  const frameCount = Number(video.nb_read_frames ?? video.nb_frames);
  const durationMs = Number.isFinite(frameCount) && Number.isFinite(fps) && fps > 0
    ? Math.round(frameCount / fps * 1000)
    : Math.round(Number(value.format?.duration ?? video.duration) * 1000);
  return {
    container: value.format?.format_name ?? '', videoCodec: video.codec_name,
    width: Number(video.width), height: Number(video.height), fps, frameCount, durationMs,
    audioCodec: audio.codec_name, sampleRate: Number(audio.sample_rate), channels: Number(audio.channels),
    audioStreams: audios.length,
  };
}

export async function createPresenterSource({
  productionRoot, inputFile, outputFile, provider,
  srtFile, portraitFile, narrationFile, alignment, authorization, approval,
  ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', runner = runCommand,
}) {
  if (!productionRoot || !inputFile || !outputFile || !provider || !srtFile || !portraitFile || !narrationFile) {
    throw new Error('presenter source requires productionRoot, inputFile, outputFile, provider, srtFile, portraitFile, and narrationFile');
  }
  const [input, srt, portrait, narration, output] = await Promise.all([
    resolveExistingRegularWithinRoot(productionRoot, inputFile, 'presenter input'),
    resolveExistingRegularWithinRoot(productionRoot, srtFile, 'presenter SRT'),
    resolveExistingRegularWithinRoot(productionRoot, portraitFile, 'presenter portrait'),
    resolveExistingRegularWithinRoot(productionRoot, narrationFile, 'presenter narration'),
    resolveNewOutputWithinRoot(productionRoot, outputFile, 'presenter contract output'),
  ]);
  await requireRegularFile(input.absolute, 'presenter input');
  const facts = await probeAudioVisual(input.absolute, { ffmpeg, ffprobe, runner, label: 'presenter input' });
  const mediaSha256 = await hashFile(input.absolute);
  const value = {
    schemaVersion: '1.0.0', provider,
    inputIdentity: {
      srt: { file: srt.locator, sha256: await hashFile(srt.absolute) },
      portrait: { file: portrait.locator, sha256: await hashFile(portrait.absolute) },
      narration: { file: narration.locator, sha256: await hashFile(narration.absolute) },
    },
    alignment, authorization,
    approval: { ...approval, approvedMediaSha256: mediaSha256 },
    media: {
      file: input.locator, sha256: mediaSha256, durationMs: facts.durationMs,
      width: facts.width, height: facts.height, fps: facts.fps, videoCodec: facts.videoCodec,
      audioCodec: facts.audioCodec, sampleRate: facts.sampleRate, channels: facts.channels, fullDecode: 'passed',
    },
  };
  const schema = await readJson(schemaFile, 'presenter source schema');
  const errors = validateSchemaValue(value, schema, schema);
  if (errors.length) throw new Error(`presenter source failed schema validation:\n- ${errors.join('\n- ')}`);
  await writeFile(output.absolute, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  return { status: 'presenter-source-ready', contract: output.absolute, mediaFacts: facts };
}

async function main() {
  const options = parseCliPairs(process.argv.slice(2));
  const result = await createPresenterSource({
    productionRoot: options['production-root'], inputFile: options.input, outputFile: options.output,
    provider: options.provider, srtFile: options.srt, portraitFile: options.portrait,
    narrationFile: options.narration,
    alignment: { method: options.alignment, status: 'confirmed' },
    authorization: { likeness: options.likeness, voice: options.voice, use: options.use },
    approval: {
      scope: options['approval-scope'], approvedBy: options['approved-by'], identity: options['identity-approval'],
      voice: options['voice-approval'], lipSync: options['lip-sync-approval'],
    },
    ffmpeg: options.ffmpeg, ffprobe: options.ffprobe,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
