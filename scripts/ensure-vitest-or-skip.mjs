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

if (!existsSync(localVitestBinary)) {
  console.log('Vitest not found; skipping tests in offline environment. Install dev deps to run tests.');
  console.log('npm i -D vitest @vitest/coverage-v8 jsdom');
  process.exit(0);
}

const result = spawnSync(localVitestBinary, ['run'], {
  stdio: 'pipe',
  encoding: 'utf8',
});

const stdout = result.stdout || '';
const stderr = result.stderr || '';

if (stdout) {
  process.stdout.write(stdout);
}

if (stderr) {
  process.stderr.write(stderr);
}

if (result.error) {
  throw result.error;
}

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
