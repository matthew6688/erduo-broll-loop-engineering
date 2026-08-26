#!/usr/bin/env node

/* Provenance audit for text a shot renders on screen.
 *
 * Reports risk signals, not a score. A pass only establishes that every
 * rendered string has a declared source; it never establishes that the wording
 * is right or that the type is readable.
 *
 * Two directions are checked, because one alone is not enough:
 *   rendered -> declared  every string on screen resolves to the SRT, the
 *                         Recipe's creativeProposal.visibleText, the visual
 *                         system vocabulary, or fixed chrome.
 *   declared -> traceable every visibleText entry names something real: an
 *                         objects entry, a vocabulary term, or spoken words.
 *                         Without this, a Builder invents a label and then
 *                         declares it, and the audit certifies its own input.
 *
 * Production scaffolding is refused outright: shot counters, stage and beat
 * names, and leftover development labels are not content and never reach a
 * viewer.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir, lstat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCAFFOLDING = [
  [/^\d{1,2}\s*\/\s*\d{1,2}$/u, 'shot counter'],
  [/^\/?\s*(CONTEXT|LAYER|RETURN|TRIAGE|SEAM|BEAT|CHAPTER)\b/iu, 'stage or structure name'],
  [/^(ASSIGNMENT|VERDICT|KEYSTATE|HERO ?FRAME|STILLNESS|CANARY|RECIPE)$/iu, 'Recipe beat or process term'],
  [/^(TODO|FIXME|DEBUG|PLACEHOLDER|LOREM|XXX)\b/iu, 'development leftover'],
  [/\bs\d{2}\b/u, 'shot id'],
];
export const CHROME = ['示意', 'SCHEMATIC'];

/* Punctuation carries no meaning for provenance: a design may set a full-width
 * space where the script wrote a comma. */
export const fold = (value) => value
  .replace(/[\s　—–…·,.;:!?，。、；：！？「」『』（）()《》“”‘’\-]/gu, '');

const readJson = async (file, label) => {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { throw new Error(`${label} is missing or invalid: ${error.message}`); }
};

export function renderedText(html) {
  const body = html.match(/<body>([\s\S]*?)<\/body>/u)?.[1] ?? html;
  const markup = body.replace(/<script[\s\S]*?<\/script>/gu, '').replace(/<!--[\s\S]*?-->/gu, '');
  const found = [];
  const seen = new Set();
  for (const match of markup.matchAll(/>([^<>]+)</gu)) {
    const text = match[1].replace(/\s+/gu, ' ').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    found.push(text);
  }
  return found;
}

/* Text drawn into a canvas, a shader, or a bitmap cannot be read from markup.
 * Say so rather than reporting a clean pass over text nobody inspected. */
function indexedSurfaceHashes(index) {
  const hashes = new Set();
  // `asset-index.json` uses `sharedMedia` for user-provided factual captures.
  // Keep accepting the older collection names, but do not reject a regular
  // serving copy whose byte hash is already closed in the canonical index.
  for (const collection of ['sharedMedia', 'sharedMaterial', 'brandAssets', 'reusableDerivatives']) {
    for (const entry of index?.[collection] ?? []) {
      if (/^[0-9a-f]{64}$/u.test(entry?.sha256 ?? '')) hashes.add(entry.sha256);
    }
  }
  return hashes;
}

function surfaceSources(html) {
  return [...html.matchAll(/<(?:img|video)\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)]
    .map((match) => match[1]);
}

async function unreadableSurfaces(html, { sourceRoot, approvedHashes }) {
  const surfaces = [];
  if (/<canvas\b/iu.test(html)) surfaces.push('canvas element: text drawn at runtime is not inspectable');
  for (const locator of surfaceSources(html)) {
    if (!sourceRoot || !approvedHashes.size || /^(?:[a-z]+:|\/)/iu.test(locator)) {
      surfaces.push(`bitmap or video ${locator}: burnt-in text is not bound to the approved asset index`);
      continue;
    }
    const absolute = path.resolve(sourceRoot, locator);
    const relative = path.relative(sourceRoot, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      surfaces.push(`bitmap or video ${locator}: asset path escapes the authored source root`);
      continue;
    }
    try {
      const info = await lstat(absolute);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('not a regular file');
      const sha256 = createHash('sha256').update(await readFile(absolute)).digest('hex');
      if (!approvedHashes.has(sha256)) {
        surfaces.push(`bitmap or video ${locator}: asset hash is not bound to the approved asset index`);
      }
    } catch {
      surfaces.push(`bitmap or video ${locator}: bound surface file is missing or unsafe`);
    }
  }
  return surfaces;
}

export async function auditOnscreenText({
  planFile, recipesDirectory, productionRoot, originalSrtFile, visualSystemFile, outputFile,
  shotIds = null,
}) {
  const root = path.resolve(productionRoot);
  const plan = await readJson(path.resolve(planFile), 'runtime plan');
  const spoken = fold((await readFile(path.resolve(originalSrtFile), 'utf8')).split('\n')
    .filter((line) => line.trim() && !/^\d+$/u.test(line.trim()) && !line.includes('-->')).join(''));
  const visualSystem = visualSystemFile ? await readJson(path.resolve(visualSystemFile), 'visual system') : {};
  const vocabulary = new Set((visualSystem.vocabulary ?? []).map(fold));
  const chrome = new Set(CHROME.map(fold));
  let approvedHashes = new Set();
  try {
    approvedHashes = indexedSurfaceHashes(await readJson(path.join(root, '02-assets', 'asset-index.json'), 'asset index'));
  } catch {
    // A production without bitmap/video surfaces does not require an asset index.
  }

  /* The shot contract names a render target, not a file. Assignments are what
   * bind a shot to the source root that authored it. */
  const assignmentsDirectory = path.join(root, '01-runtime-plan', 'assignments');
  const sourceRootByShot = new Map();
  for (const name of (await readdir(assignmentsDirectory)).filter((entry) => entry.endsWith('.json'))) {
    const assignment = await readJson(path.join(assignmentsDirectory, name), `assignment ${name}`);
    const sourceRoot = assignment.sourceRoot ?? assignment.output?.sharedSourceRoot;
    if (!sourceRoot) continue;
    for (const shotId of assignment.shotIds ?? []) sourceRootByShot.set(shotId, sourceRoot);
  }

  const requested = shotIds === null ? null : [...new Set(shotIds)];
  if (requested && requested.length === 0) throw new Error('onscreen text audit requires at least one shot ID');
  const contracts = new Map();
  if (requested === null) {
    const shotsDirectory = path.join(root, '05-delivery', 'shots');
    const contractNames = (await readdir(shotsDirectory))
      .filter((name) => name.endsWith('.shot-media.json')).sort();
    if (!contractNames.length) throw new Error('no delivered shot contracts to audit');
    for (const name of contractNames) {
      const contract = await readJson(path.join(shotsDirectory, name), `${name} contract`);
      contracts.set(contract.shotId, contract);
    }
  }
  const selectedShotIds = requested ?? [...contracts.keys()];
  const plannedShotIds = new Set(plan.shots.map(({shotId}) => shotId));
  for (const shotId of selectedShotIds) {
    if (!plannedShotIds.has(shotId)) throw new Error(`onscreen text audit names unplanned shot ${shotId}`);
  }

  const shots = [];
  for (const shotId of selectedShotIds) {
    const contract = contracts.get(shotId);
    const recipe = await readJson(path.join(path.resolve(recipesDirectory), `${shotId}.json`),
      `${shotId} Recipe`);
    const findings = [];
    const unmeasured = [];

    /* declared -> traceable */
    const declared = new Set();
    const objects = new Set((recipe.creativeProposal.objects ?? []).map(fold));
    for (const entry of recipe.creativeProposal.visibleText ?? []) {
      const folded = fold(entry.text);
      declared.add(folded);
      if (entry.source === 'srt' && !spoken.includes(folded)) {
        findings.push({ signal: 'declaration-not-traceable', text: entry.text,
          detail: 'declared as spoken, but the words are not in the original SRT' });
      }
      if (entry.source === 'object') {
        if (!entry.objectRef) {
          findings.push({ signal: 'declaration-not-traceable', text: entry.text,
            detail: 'declared as an object name without naming which object' });
        } else if (!objects.has(fold(entry.objectRef))) {
          findings.push({ signal: 'declaration-not-traceable', text: entry.text,
            detail: `objectRef ${JSON.stringify(entry.objectRef)} is not in creativeProposal.objects` });
        }
      }
      if (entry.source === 'vocabulary' && vocabulary.size && !vocabulary.has(folded)) {
        findings.push({ signal: 'declaration-not-traceable', text: entry.text,
          detail: 'declared as shared vocabulary, but the visual system does not list it' });
      }
    }

    /* rendered -> declared */
    const sourceRoot = sourceRootByShot.get(shotId);
    const renderTargetId = contract?.renderTarget?.id ?? shotId;
    const sourceFile = sourceRoot
      ? path.join(root, sourceRoot, 'compositions', `${renderTargetId}.html`)
      : null;
    let html = null;
    if (sourceFile) {
      try { html = await readFile(sourceFile, 'utf8'); } catch { html = null; }
    }
    if (html === null) {
      unmeasured.push('authored source for this shot was not located: rendered text not inspected');
    } else {
      unmeasured.push(...await unreadableSurfaces(html, {
        sourceRoot: path.resolve(root, sourceRoot), approvedHashes,
      }));
      for (const text of renderedText(html)) {
        const scaffolding = SCAFFOLDING.find(([pattern]) => pattern.test(text));
        if (scaffolding) {
          findings.push({ signal: 'production-scaffolding-on-screen', text, detail: scaffolding[1] });
          continue;
        }
        const folded = fold(text);
        if (!folded) continue;
        if (declared.has(folded) || chrome.has(folded) || vocabulary.has(folded)) continue;
        if (spoken.includes(folded)) continue;
        findings.push({ signal: 'rendered-text-without-source', text,
          detail: 'neither spoken, nor declared in creativeProposal.visibleText, nor shared vocabulary' });
      }
    }

    shots.push({
      shotId,
      status: findings.length ? 'signals' : (unmeasured.length ? 'unmeasured' : 'passed'),
      measurements: { declaredStrings: declared.size, inspectedSource: sourceFile ? path.relative(root, sourceFile) : null },
      findings,
      ...(unmeasured.length ? { unmeasured } : {}),
    });
  }

  const report = {
    schemaVersion: '1.0.0', audit: 'onscreen-text', planIdentity: plan.identity,
    status: shots.some(({ findings }) => findings.length)
      ? 'signals' : shots.some(({unmeasured}) => unmeasured?.length) ? 'unmeasured' : 'passed',
    thresholds: {}, thresholdSource: 'default', shots,
  };
  const output = outputFile
    ? path.resolve(outputFile)
    : path.join(root, '05-delivery', 'checks', 'onscreen-text.audit.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, output };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!['--plan', '--recipes', '--production-root', '--original-srt', '--visual-system', '--output', '--shot-ids'].includes(name)) {
      throw new Error(`unknown argument ${name}`);
    }
    if (!value) throw new Error(`${name} requires a value`);
    options[name.slice(2)] = value;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  for (const required of ['plan', 'recipes', 'production-root', 'original-srt']) {
    if (!options[required]) throw new Error(`--${required} is required`);
  }
  const report = await auditOnscreenText({
    planFile: options.plan, recipesDirectory: options.recipes,
    productionRoot: options['production-root'], originalSrtFile: options['original-srt'],
    visualSystemFile: options['visual-system'], outputFile: options.output,
    shotIds: options['shot-ids']?.split(',').map((value) => value.trim()).filter(Boolean) ?? null,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'passed') process.exitCode = 2;
}

if (process.argv[1]
  && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
