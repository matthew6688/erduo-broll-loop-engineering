import {appendFile, lstat, mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';

export const MAX_RENDER_ATTEMPTS = 2;

function attemptsFileFor(productionRoot, assignment) {
  const root = path.resolve(productionRoot);
  const workDirectory = assignment?.output?.workDirectory;
  if (typeof workDirectory !== 'string' || workDirectory.length === 0 || path.isAbsolute(workDirectory)) {
    throw new Error('assignment render-attempt budget requires a relative output.workDirectory');
  }
  const file = path.resolve(root, workDirectory, 'checks', 'render-attempts.ndjson');
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('assignment render-attempt budget escapes the production root');
  }
  return file;
}

async function readRecords(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('render-attempt log must be a regular non-symlink file');
    }
    const body = await readFile(file, 'utf8');
    return body.split('\n').filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); } catch {
        throw new Error(`render-attempt log line ${index + 1} is not valid JSON`);
      }
    });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function assertRecord(record, index) {
  if (record?.schemaVersion !== '1.0.0'
    || !['started', 'passed', 'failed'].includes(record.status)
    || typeof record.attemptId !== 'string'
    || typeof record.planIdentity !== 'string'
    || typeof record.assignmentId !== 'string'
    || !Number.isInteger(record.sequence) || record.sequence < 1
    || !Number.isFinite(Date.parse(record.occurredAt))) {
    throw new Error(`render-attempt log line ${index + 1} is invalid`);
  }
}

async function appendRecord(file, record) {
  await mkdir(path.dirname(file), {recursive: true});
  await appendFile(file, `${JSON.stringify(record)}\n`, {encoding: 'utf8', flag: 'a'});
}

export async function beginRenderAttempt({productionRoot, assignment, planIdentity, sourceIdentity, now = () => new Date()}) {
  const file = attemptsFileFor(productionRoot, assignment);
  const records = await readRecords(file);
  records.forEach(assertRecord);
  const starts = records.filter((record) => (
    record.status === 'started'
    && record.planIdentity === planIdentity
    && record.assignmentId === assignment.assignmentId
  ));
  if (starts.length >= MAX_RENDER_ATTEMPTS) {
    throw new Error(
      `${assignment.assignmentId} exhausted its ${MAX_RENDER_ATTEMPTS}-attempt render budget; stop retrying and return to the Recipe or runtime plan`,
    );
  }
  const sequence = starts.length + 1;
  const attempt = {
    schemaVersion: '1.0.0', status: 'started',
    attemptId: `${assignment.assignmentId}-render-${sequence}`,
    planIdentity, assignmentId: assignment.assignmentId, sequence,
    sourceIdentity, occurredAt: now().toISOString(),
  };
  await appendRecord(file, attempt);
  return {file, attempt};
}

export async function finishRenderAttempt({file, attempt, status, detailCode = null, now = () => new Date()}) {
  if (!['passed', 'failed'].includes(status)) throw new Error('render attempt outcome must be passed or failed');
  const records = await readRecords(file);
  records.forEach(assertRecord);
  const matching = records.filter(({attemptId}) => attemptId === attempt.attemptId);
  if (matching.length !== 1 || matching[0].status !== 'started') {
    throw new Error(`${attempt.attemptId} render attempt cannot be closed from its current log state`);
  }
  const outcome = {
    ...attempt, status, occurredAt: now().toISOString(),
    ...(detailCode ? {detailCode} : {}),
  };
  await appendRecord(file, outcome);
  return outcome;
}
