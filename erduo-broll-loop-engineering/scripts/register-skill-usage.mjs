#!/usr/bin/env node

import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {registerSkillUsage} from './skill-usage.mjs';
import {isDirectExecution} from './direct-execution.mjs';

function options(argv) {
  const value = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const entry = argv[index + 1];
    if (!['--production-root', '--skill-file', '--skill-name'].includes(key) || !entry) {
      throw new Error(`invalid argument ${key ?? ''}`);
    }
    value[key.slice(2)] = entry;
  }
  return value;
}

async function main() {
  const value = options(process.argv.slice(2));
  const result = await registerSkillUsage({
    productionRoot: value['production-root'], skillFile: value['skill-file'], skillName: value['skill-name'],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
