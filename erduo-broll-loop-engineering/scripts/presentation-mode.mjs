import {createHash} from 'node:crypto';
import {lstat, readFile, writeFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';

import {canonicalJson, validateSchemaValue} from './runtime-schema-validator.mjs';
import {hashFile, readJson} from './shot-media-lib.mjs';
import {
  presenterKindOf, resolveExistingRegularWithinRoot, resolveNewOutputWithinRoot,
} from './presenter-media-lib.mjs';

const schemaFile = path.resolve(import.meta.dirname, '..', 'references', 'runtime', 'presentation-mode.schema.json');
const presenterSchemaFile = path.resolve(import.meta.dirname, '..', 'references', 'runtime', 'presenter-source.schema.json');

function identityOf(value) {
  const normalized = structuredClone(value);
  delete normalized.identity;
  return createHash('sha256').update(canonicalJson(normalized)).digest('hex');
}

function bindProfile(value) {
  const profile = structuredClone(value);
  delete profile.identity;
  return {
    ...profile,
    identity: createHash('sha256').update(canonicalJson(profile)).digest('hex'),
  };
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !path.isAbsolute(relative)
    && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

async function schemaErrors(value, file) {
  const schema = await readJson(file, `${path.basename(file)} schema`);
  return validateSchemaValue(value, schema, schema);
}

function modePolicy(mode) {
  if (mode === 'original') return {
    presenter: {requiredKind: 'any', layout: 'full-frame-source', position: 'source'},
    broll: {defaultLayout: 'full-frame-cutaway', allowFullFrame: true, sourceAspect: 'production-profile'},
    transition: {default: 'cut-or-match', splitBoundary: 'none'},
  };
  if (mode === 'avatar-center') return {
    presenter: {requiredKind: 'digital', layout: 'centered-full-frame', position: 'center'},
    broll: {defaultLayout: 'full-frame-cutaway', allowFullFrame: true, sourceAspect: 'production-profile'},
    transition: {default: 'cut-or-match', splitBoundary: 'none'},
  };
  if (mode === 'avatar-split') return {
    presenter: {requiredKind: 'digital', layout: 'full-frame-base', position: 'right'},
    broll: {defaultLayout: 'left-vertical-overlay', allowFullFrame: true, sourceAspect: '9:16'},
    transition: {default: 'cut', splitBoundary: 'soft-edge-blend'},
  };
  throw new Error('mode must be original, avatar-center, or avatar-split');
}

function assertApproval(value) {
  if (value.approval.status === 'approved' && value.approval.approvedBy !== 'user') {
    throw new Error('approved presentation mode requires approvedBy=user');
  }
  if (value.approval.status === 'draft' && value.approval.approvedBy !== null) {
    throw new Error('draft presentation mode must keep approvedBy=null');
  }
}

function assertModeFacts(value, presenterSource = null) {
  const {mode} = value;
  const expected = modePolicy(mode);
  if (canonicalJson(value.presenter) !== canonicalJson(expected.presenter)
    || canonicalJson(value.broll) !== canonicalJson(expected.broll)
    || canonicalJson(value.transition) !== canonicalJson(expected.transition)) {
    throw new Error(`${mode} presentation policy differs from its frozen layout`);
  }
  if (mode !== 'original' && (!presenterSource || presenterKindOf(presenterSource) !== 'digital')) {
    throw new Error(`${mode} requires a bound digital presenter source`);
  }
  if (mode === 'avatar-split') {
    if (value.output.width <= value.output.height) throw new Error('avatar-split output must be landscape');
    if (value.brollProductionProfile.width >= value.brollProductionProfile.height) {
      throw new Error('avatar-split requires a portrait B-roll production profile');
    }
  } else if (value.output.width !== value.brollProductionProfile.width
    || value.output.height !== value.brollProductionProfile.height) {
    throw new Error(`${mode} output must match the B-roll production profile raster`);
  }
}

export async function validatePresentationModeContract(value, {presenterSource = null} = {}) {
  const errors = await schemaErrors(value, schemaFile);
  if (errors.length) throw new Error(`presentation mode failed schema validation:\n- ${errors.join('\n- ')}`);
  assertApproval(value);
  assertModeFacts(value, presenterSource);
  if (identityOf(value) !== value.identity) throw new Error('presentation mode identity differs from its contents');
  return value;
}

export async function createPresentationMode({
  productionRoot,
  mode,
  originalDesignFile,
  productionProfileFile,
  presenterSourceFile = null,
  outputFile = path.join(productionRoot, '00-inputs', 'presentation-mode.json'),
  approvalStatus = 'draft',
  approvedBy = null,
  outputWidth = null,
  outputHeight = null,
}) {
  const root = realpathSync(path.resolve(productionRoot));
  const [design, profile, output] = await Promise.all([
    resolveExistingRegularWithinRoot(root, originalDesignFile, 'original design'),
    resolveExistingRegularWithinRoot(root, productionProfileFile, 'production profile'),
    resolveNewOutputWithinRoot(root, outputFile, 'presentation mode'),
  ]);
  const profileValue = await readJson(profile.absolute, 'production profile');
  if (bindProfile(profileValue).identity !== profileValue.identity) {
    throw new Error('production profile identity differs from its contents');
  }
  let presenter = null;
  let presenterRecord = null;
  if (presenterSourceFile) {
    presenterRecord = await resolveExistingRegularWithinRoot(root, presenterSourceFile, 'presenter source');
    presenter = await readJson(presenterRecord.absolute, 'presenter source');
    const errors = await schemaErrors(presenter, presenterSchemaFile);
    if (errors.length) throw new Error(`presenter source failed schema validation:\n- ${errors.join('\n- ')}`);
  }
  const fps = profileValue.fps.numerator / profileValue.fps.denominator;
  const finalWidth = Number(outputWidth ?? (mode === 'avatar-split' ? 1920 : profileValue.raster.width));
  const finalHeight = Number(outputHeight ?? (mode === 'avatar-split' ? 1080 : profileValue.raster.height));
  if (!Number.isSafeInteger(finalWidth) || !Number.isSafeInteger(finalHeight)
    || finalWidth <= 0 || finalHeight <= 0 || finalWidth % 2 || finalHeight % 2) {
    throw new Error('presentation output width and height must be positive even integers');
  }
  const value = {
    schemaVersion: '1.0.0',
    mode,
    approval: {status: approvalStatus, approvedBy},
    designPolicy: {
      brollDesign: 'original-designmd-unchanged', presenterBranding: 'presenter-layer-only', themeOverride: false,
    },
    brollProductionProfile: {
      locator: profile.locator, sha256: await hashFile(profile.absolute), identity: profileValue.identity,
      width: profileValue.raster.width, height: profileValue.raster.height, fps,
    },
    output: {width: finalWidth, height: finalHeight, fps},
    ...modePolicy(mode),
    originalDesign: {locator: design.locator, sha256: await hashFile(design.absolute)},
    ...(presenterRecord ? {presenterSource: {
      locator: presenterRecord.locator, sha256: await hashFile(presenterRecord.absolute),
      mediaSha256: presenter.media.sha256, presenterKind: presenterKindOf(presenter),
    }} : {}),
  };
  value.identity = identityOf(value);
  await validatePresentationModeContract(value, {presenterSource: presenter});
  await writeFile(output.absolute, `${JSON.stringify(value, null, 2)}\n`, {flag: 'wx'});
  return {status: approvalStatus === 'approved' ? 'approved' : 'draft', output: output.absolute, presentationMode: value};
}

export async function bindPresentationModeContext({
  productionRoot, presentationModeFile, originalDesignFile, presenterSourceFile = null,
  productionProfile,
}) {
  if (!presentationModeFile) return null;
  const root = realpathSync(path.resolve(productionRoot));
  const absolute = realpathSync(path.resolve(presentationModeFile));
  if (!inside(root, absolute)) throw new Error('presentation mode must be inside the production root');
  const info = await lstat(path.resolve(presentationModeFile));
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('presentation mode must be a real non-symlink file');
  const value = await readJson(absolute, 'presentation mode');
  const presenter = presenterSourceFile ? await readJson(
    (await resolveExistingRegularWithinRoot(root, presenterSourceFile, 'presenter source')).absolute,
    'presenter source',
  ) : null;
  await validatePresentationModeContract(value, {presenterSource: presenter});
  if (value.approval.status !== 'approved' || value.approval.approvedBy !== 'user') {
    throw new Error('runtime planning requires a user-approved presentation mode');
  }
  const design = await resolveExistingRegularWithinRoot(root, originalDesignFile, 'original design');
  if (value.originalDesign.locator !== design.locator
    || value.originalDesign.sha256 !== await hashFile(design.absolute)) {
    throw new Error('presentation mode original DesignMD binding changed');
  }
  const boundProfile = bindProfile(productionProfile);
  if (value.brollProductionProfile.identity !== boundProfile.identity
    || value.brollProductionProfile.width !== boundProfile.raster.width
    || value.brollProductionProfile.height !== boundProfile.raster.height) {
    throw new Error('presentation mode B-roll production profile differs from runtime planning');
  }
  return {
    locator: path.relative(root, absolute).split(path.sep).join('/'),
    sha256: await hashFile(absolute), identity: value.identity, mode: value.mode,
    output: value.output, brollDefaultLayout: value.broll.defaultLayout,
  };
}
