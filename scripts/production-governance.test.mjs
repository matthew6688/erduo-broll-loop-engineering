import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  finalizeProductionGovernance,
  validateProductionGovernance,
} from '../erduo-broll-loop-engineering/scripts/validate-production-governance.mjs';

const colors = ['#F6F2E8', '#171A18', '#0F4C5C', '#E85D34', '#DCE8E5', '#D9D2C3'];
const fonts = ['Noto Sans SC', 'Instrument Sans'];

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'erduo-governance-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const inputs = path.join(root, '00-inputs');
  const source = path.join(root, 'source');
  await Promise.all([mkdir(inputs, {recursive: true}), mkdir(source, {recursive: true})]);
  const authority = path.join(root, 'brand-authority.md');
  const logo = path.join(root, 'fengtalk-wordmark-light.svg');
  const design = path.join(inputs, 'original-design.md');
  const visualSystem = path.join(root, 'visual-system.json');
  const draft = path.join(root, 'governance-draft.json');
  await Promise.all([
    writeFile(authority, '# Canonical authority\n'),
    writeFile(logo, '<svg id="approved-logo"/>\n'),
    writeFile(design, `# Bound design\n\n${colors.join(' ')}\n${fonts.join(' / ')}\nfengtalk-wordmark-light.svg\nAvoid glassmorphism and code rain.\n`),
    writeFile(visualSystem, `${JSON.stringify({
      paletteRoles: colors.map((value, index) => ({role: `c${index}`, value})),
      typographyRoles: fonts.map((family) => ({family})),
      materials: ['fengtalk-wordmark-light.svg'],
      prohibitedLazyDefaults: ['glassmorphism', 'code rain'],
    })}\n`),
    writeFile(path.join(source, 'scene.css'), `:root{${colors.map((value, index) => `--c${index}:${value}`).join(';')}} body{font-family:"Noto Sans SC","Instrument Sans"} /* fengtalk-wordmark-light.svg */\n`),
  ]);
  await writeFile(draft, `${JSON.stringify({
    schemaVersion: '1.0.0', status: 'active', profileId: 'fengtalk-harbor-signal',
    authorities: [{role: 'canonical-brand', locator: authority}],
    originalDesign: {role: 'original-design', locator: '00-inputs/original-design.md'},
    approval: {approvedBy: 'user', approvedAt: '2026-08-23T09:30:00+10:00', scope: 'brand-and-workflow-constraints'},
    rules: {
      allowedColors: colors, requiredColors: colors, forbiddenColors: ['#B7F34A'],
      allowedFontFamilies: [...fonts, 'Instrument Serif'], requiredFontFamilies: fonts,
      approvedLogoAssets: [{role: 'light-wordmark', locator: logo}],
      requireLogoReference: true, forbiddenVisualTerms: ['glassmorphism', 'code rain'],
    },
    workflow: {
      stages: ['director', 'runtime-plan', 'assets', 'lead', 'chapter-builder', 'parent-audits', 'user-canary', 'full-production'],
      canaryShotCount: 5, minimumUserPreferredShots: 3,
      fullProductionBlockedUntil: 'technical-and-user-passed', publicationRequiresExplicitApproval: true,
    },
  }, null, 2)}\n`);
  await finalizeProductionGovernance({productionRoot: root, draftFile: draft});
  return {authority, design, logo, root, source, visualSystem};
}

test('governance lock closes design, Director, and production-source stages', async (t) => {
  const value = await fixture(t);
  assert.equal((await validateProductionGovernance({productionRoot: value.root})).stage, 'design');
  assert.equal((await validateProductionGovernance({
    productionRoot: value.root, stage: 'director', visualSystemFile: value.visualSystem,
  })).stage, 'director');
  assert.equal((await validateProductionGovernance({
    productionRoot: value.root, stage: 'source', visualSystemFile: value.visualSystem, sourceRoot: value.source,
  })).stage, 'source');
  const lock = JSON.parse(await readFile(path.join(value.root, 'production-governance.lock.json'), 'utf8'));
  assert.match(lock.contractSha256, /^[0-9a-f]{64}$/u);
  assert.match(lock.contractIdentity, /^[0-9a-f]{64}$/u);
});

test('governance lock rejects authority drift', async (t) => {
  const value = await fixture(t);
  await writeFile(value.authority, '# Changed authority\n');
  await assert.rejects(
    validateProductionGovernance({productionRoot: value.root}),
    /authority 1 hash differs/u,
  );
});

test('Director and source gates reject non-approved colors', async (t) => {
  const value = await fixture(t);
  const visual = JSON.parse(await readFile(value.visualSystem, 'utf8'));
  visual.paletteRoles[0].value = '#B7F34A';
  await writeFile(value.visualSystem, `${JSON.stringify(visual)}\n`);
  await assert.rejects(
    validateProductionGovernance({productionRoot: value.root, stage: 'director', visualSystemFile: value.visualSystem}),
    /non-approved color #b7f34a/u,
  );

  const second = await fixture(t);
  await writeFile(path.join(second.source, 'scene.css'), `:root{--rogue:#B7F34A} ${colors.join(' ')} ${fonts.join(' ')} fengtalk-wordmark-light.svg\n`);
  await assert.rejects(
    validateProductionGovernance({
      productionRoot: second.root, stage: 'source', visualSystemFile: second.visualSystem, sourceRoot: second.source,
    }),
    /non-approved color #b7f34a/u,
  );
});

test('forbidden styles may be named only in policy and Director prohibition fields', async (t) => {
  const value = await fixture(t);
  assert.equal((await validateProductionGovernance({productionRoot: value.root})).stage, 'design');

  const second = await fixture(t);
  const visual = JSON.parse(await readFile(second.visualSystem, 'utf8'));
  visual.materials.push('glassmorphism');
  await writeFile(second.visualSystem, `${JSON.stringify(visual)}\n`);
  await assert.rejects(
    validateProductionGovernance({productionRoot: second.root, stage: 'director', visualSystemFile: second.visualSystem}),
    /contains forbidden visual term glassmorphism/u,
  );

  const third = await fixture(t);
  const missing = JSON.parse(await readFile(third.visualSystem, 'utf8'));
  missing.prohibitedLazyDefaults = ['glassmorphism'];
  await writeFile(third.visualSystem, `${JSON.stringify(missing)}\n`);
  await assert.rejects(
    validateProductionGovernance({productionRoot: third.root, stage: 'director', visualSystemFile: third.visualSystem}),
    /prohibitedLazyDefaults is missing code rain/u,
  );
});

test('governance finalization never overwrites an existing lock', async (t) => {
  const value = await fixture(t);
  await assert.rejects(
    finalizeProductionGovernance({productionRoot: value.root, draftFile: path.join(value.root, 'governance-draft.json')}),
    /EEXIST/u,
  );
});
