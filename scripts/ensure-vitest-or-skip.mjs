#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const localVitestBinary = resolve(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vitest.cmd' : 'vitest',
);

const args = new Set(process.argv.slice(2));
const skipIfMissing =
  args.has('--skip') || args.has('--skip-if-missing') || process.env.VITEST_SKIP_IF_MISSING === '1';
const strictMode = args.has('--strict') || !skipIfMissing;

if (!existsSync(localVitestBinary)) {
  if (skipIfMissing) {
    if (strictMode) {
      console.error('Vitest is required to run tests in strict mode.');
      console.error('Install with: npm i -D vitest @vitest/coverage-v8 jsdom');
      process.exit(1);
    }

    console.log('Skipping tests: Vitest binary not found.');
    console.log('Install with: npm i -D vitest @vitest/coverage-v8 jsdom');
    process.exit(0);
  }
  console.error('Vitest is required to run tests in strict mode.');
  console.error('Install with: npm i -D vitest @vitest/coverage-v8 jsdom');
  process.exit(1);
}

const result = spawnSync(localVitestBinary, ['run'], {
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
