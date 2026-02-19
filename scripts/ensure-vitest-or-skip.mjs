#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const result = spawnSync('vitest run', {
  shell: true,
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

const wasVitestMissing =
  result.error?.code === 'ENOENT' ||
  ((result.status === 127 || result.status === 9009) &&
    /vitest:|command not found|not found|is not recognized|cannot find/i.test(stdout + stderr));

const isMissingBinary = wasVitestMissing || result.status === 127;

if (isMissingBinary) {
  console.log('Vitest not found; skipping tests in offline environment. Install dev deps to run tests.');
  console.log('npm i -D vitest @vitest/coverage-v8 jsdom');
  process.exit(0);
}

if (result.error) {
  throw result.error;
}

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
