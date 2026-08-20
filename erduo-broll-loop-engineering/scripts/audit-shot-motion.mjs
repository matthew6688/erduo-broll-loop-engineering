#!/usr/bin/env node

/* Frame-differencing motion audit for delivered shot media.
 *
 * Reports risk signals, not a score. A pass only establishes that rendered
 * pixel energy stayed above the configured floor; it is never aesthetic
 * approval, and an unchanged readable hold is not a defect.
 *
 * This is not a replacement for motion-layout-lint. When a backend supplies a
 * runtime trace, run that lint as well: it binds planned beats to named
 * elements, which pixel energy cannot do. This audit exists because
 * plan-runtime returns no trace locator outside Remotion, leaving frozen
 * HyperFrames shots undetected by every other mechanical gate.
 */

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Derived from the frame-difference distribution of a finished 9:16 film, which
 * is strongly bimodal: a held frame sits near 0.001, and the slowest visible
 * travel of sparse type sits near 0.03. Anything between p20 (0.002) and p30
 * (0.079) separates the two, so the cutoff sits an order of magnitude above a
 * held frame and an order of magnitude below deliberate slow motion. Re-derive
 * per project by printing percentiles rather than guessing: a cutoff set near
 * the median reads deliberate slow travel as a freeze.
 *
 * minMeanDiff answers "is anything developing at all", not "is there enough
 * motion". A frozen board shot measures 0.03; the same shot rebuilt measures
 * 0.33; a shot carried by full-frame events measures above 1.0. */
export const DEFAULT_THRESHOLDS = {
  stillCutoff: 0.01,
  tailGraceMs: 350,
  maxMidStillMs: 750,
  minMeanDiff: 0.25,
  analysisShortEdgePx: 192,
};

const readJson = async (file, label) => {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { throw new Error(`${label} is missing or invalid: ${error.message}`); }
};

function decodeGray(file, { width, height, ffmpeg }) {
  const result = spawnSync(ffmpeg, ['-v', 'error', '-i', file,
    '-vf', `scale=${width}:${height},format=gray`, '-f', 'rawvideo', '-'],
  { maxBuffer: 1024 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`ffmpeg could not decode ${path.basename(file)}`);
  const bytes = result.stdout;
  const frame = width * height;
  const count = Math.floor(bytes.length / frame);
  if (count < 2) throw new Error(`${path.basename(file)} decoded fewer than two frames`);
  return { bytes, frame, count };
}

/* Mean absolute difference between consecutive frames, one value per gap. */
function frameDeltas({ bytes, frame, count }) {
  const deltas = new Array(count - 1);
  for (let index = 1; index < count; index += 1) {
    const previous = index * frame - frame;
    const current = index * frame;
    let total = 0;
    for (let offset = 0; offset < frame; offset += 1) {
      total += Math.abs(bytes[current + offset] - bytes[previous + offset]);
    }
    deltas[index - 1] = total / frame;
  }
  return deltas;
}

function stillRuns(deltas, cutoff) {
  const runs = [];
  let run = 0;
  for (const delta of deltas) {
    if (delta < cutoff) { run += 1; continue; }
    if (run) runs.push(run);
    run = 0;
  }
  return { runs, tail: run };
}

/* truth.readableHold wins; motion-map settleMs is the documented fallback. */
function holdWindow(recipe, motionMap) {
  const declared = recipe?.truth?.readableHold;
  if (declared) return { startMs: declared.startMs, endMs: declared.endMs, source: 'truth.readableHold' };
  const entry = motionMap?.shots?.find(({ shotId }) => shotId === recipe.shotId);
  if (entry && Number.isInteger(entry.settleMs)) {
    const { startMs, endMs } = recipe.truth.srtWindowMs;
    return { startMs: Math.max(startMs, endMs - entry.settleMs), endMs, source: 'motion-map.settleMs' };
  }
  return null;
}

export async function auditShotMotion({
  planFile, recipesDirectory, productionRoot, motionMapFile, outputFile,
  ffmpeg = 'ffmpeg',
}) {
  const root = path.resolve(productionRoot);
  const plan = await readJson(path.resolve(planFile), 'runtime plan');
  const configured = plan.productionProfile?.renderedEvidence?.motion;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(configured ?? {}) };
  const thresholdSource = configured ? 'production-profile' : 'default';
  const motionMap = motionMapFile ? await readJson(path.resolve(motionMapFile), 'motion map') : null;

  const shotsDirectory = path.join(root, '05-delivery', 'shots');
  const contractNames = (await readdir(shotsDirectory))
    .filter((name) => name.endsWith('.shot-media.json')).sort();
  if (!contractNames.length) throw new Error('no delivered shot contracts to audit');

  const { width: rasterWidth, height: rasterHeight } = plan.productionProfile.raster;
  const short = thresholds.analysisShortEdgePx;
  const width = rasterWidth <= rasterHeight ? short : Math.round(short * rasterWidth / rasterHeight);
  const height = rasterWidth <= rasterHeight ? Math.round(short * rasterHeight / rasterWidth) : short;

  const shots = [];
  for (const name of contractNames) {
    const contract = await readJson(path.join(shotsDirectory, name), `${name} contract`);
    const recipe = await readJson(path.join(path.resolve(recipesDirectory), `${contract.shotId}.json`),
      `${contract.shotId} Recipe`);
    const media = path.join(root, '05-delivery', contract.media.path);
    const decoded = decodeGray(media, { width, height, ffmpeg });
    const deltas = frameDeltas(decoded);
    const fps = contract.media.fps;
    const { runs, tail } = stillRuns(deltas, thresholds.stillCutoff);

    const hold = holdWindow(recipe, motionMap);
    const findings = [];
    const unmeasured = [];
    const tailMs = Math.round(tail / fps * 1000);
    const midStillMs = Math.round((runs.length ? Math.max(...runs) : 0) / fps * 1000);

    let actionMean = null;
    if (hold) {
      const holdMs = Math.max(0, hold.endMs - hold.startMs);
      const actionGaps = Math.max(1, Math.round((hold.startMs - recipe.truth.srtWindowMs.startMs) / 1000 * fps) - 1);
      const action = deltas.slice(0, actionGaps);
      actionMean = action.reduce((sum, value) => sum + value, 0) / action.length;
      if (tailMs > holdMs + thresholds.tailGraceMs) {
        findings.push({ signal: 'tail-still-exceeds-declared-hold',
          detail: `still tail ${tailMs}ms against a ${holdMs}ms hold declared by ${hold.source}` });
      }
      if (actionMean < thresholds.minMeanDiff) {
        findings.push({ signal: 'action-window-below-energy-floor',
          detail: `mean inter-frame difference ${actionMean.toFixed(2)} before the hold, floor ${thresholds.minMeanDiff}` });
      }
    } else {
      unmeasured.push('no truth.readableHold and no motion-map settleMs: tail and action-window signals not evaluated');
    }
    if (midStillMs > thresholds.maxMidStillMs) {
      findings.push({ signal: 'mid-shot-still-run',
        detail: `longest still run before the tail is ${midStillMs}ms, ceiling ${thresholds.maxMidStillMs}ms` });
    }

    shots.push({
      shotId: contract.shotId,
      status: findings.length ? 'signals' : (unmeasured.length ? 'unmeasured' : 'passed'),
      measurements: {
        frames: decoded.count, fps,
        analysisRaster: { width, height },
        tailStillMs: tailMs, longestMidStillMs: midStillMs,
        actionWindowMeanDiff: actionMean === null ? null : Number(actionMean.toFixed(3)),
        holdSource: hold?.source ?? null,
      },
      findings,
      ...(unmeasured.length ? { unmeasured } : {}),
    });
  }

  const report = {
    schemaVersion: '1.0.0', audit: 'shot-motion', planIdentity: plan.identity,
    status: shots.some(({ findings }) => findings.length) ? 'signals' : 'passed',
    thresholds, thresholdSource, shots,
  };
  const output = outputFile
    ? path.resolve(outputFile)
    : path.join(root, '05-delivery', 'checks', 'shot-motion.audit.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, output };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!['--plan', '--recipes', '--production-root', '--motion-map', '--output'].includes(name)) {
      throw new Error(`unknown argument ${name}`);
    }
    if (!value) throw new Error(`${name} requires a value`);
    options[name.slice(2)] = value;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  for (const required of ['plan', 'recipes', 'production-root']) {
    if (!options[required]) throw new Error(`--${required} is required`);
  }
  const report = await auditShotMotion({
    planFile: options.plan, recipesDirectory: options.recipes,
    productionRoot: options['production-root'], motionMapFile: options['motion-map'],
    outputFile: options.output,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === 'signals') process.exitCode = 2;
}

if (process.argv[1]
  && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
