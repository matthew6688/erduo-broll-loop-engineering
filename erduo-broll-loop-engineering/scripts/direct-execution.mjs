import {realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function isDirectExecution(metaUrl, argvEntry = process.argv[1]) {
  if (!argvEntry) return false;
  try {
    return realpathSync(path.resolve(argvEntry)) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}
