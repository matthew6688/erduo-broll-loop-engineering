#!/usr/bin/env node

import {isDirectExecution} from './direct-execution.mjs';
import {parseCliPairs} from './presenter-media-lib.mjs';
import {createPresentationMode} from './presentation-mode.mjs';

async function main() {
  const options = parseCliPairs(process.argv.slice(2));
  const approvalStatus = options.approval ?? 'draft';
  const result = await createPresentationMode({
    productionRoot: options['production-root'], mode: options.mode,
    originalDesignFile: options['original-design'], productionProfileFile: options['production-profile'],
    presenterSourceFile: options['presenter-source'], outputFile: options.output,
    approvalStatus, approvedBy: approvalStatus === 'approved' ? options['approved-by'] : null,
    outputWidth: options['output-width'], outputHeight: options['output-height'],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
