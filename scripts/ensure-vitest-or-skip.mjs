#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const vitestBinaryName = process.platform === 'win32' ? 'vitest.cmd' : 'vitest';
const localVitestPackageRoot = resolve(process.cwd(), 'node_modules', 'vitest');
const packageJsonPath = resolve(localVitestPackageRoot, 'package.json');
const packageVitestPath = (() => {
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }

  try {
    const vitestPackage = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const packageBin = vitestPackage.bin;

    if (typeof packageBin === 'string') {
      return resolve(localVitestPackageRoot, packageBin);
    }

    if (packageBin && typeof packageBin === 'object' && typeof packageBin.vitest === 'string') {
      return resolve(localVitestPackageRoot, packageBin.vitest);
    }

    return undefined;
  } catch {
    return undefined;
  }
})();

const localVitestCandidates = [
  resolve(process.cwd(), 'node_modules', '.bin', vitestBinaryName),
  resolve(process.cwd(), 'node_modules', 'vitest', vitestBinaryName),
  packageVitestPath,
  resolve(process.cwd(), 'node_modules', 'vitest', 'bin', vitestBinaryName),
  resolve(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs'),
  resolve(process.cwd(), 'node_modules', 'vitest', 'bin', 'vitest.mjs'),
].filter((candidate) => candidate && existsSync(candidate));

const localVitestBinary = localVitestCandidates[0];

const args = new Set(process.argv.slice(2));
const skipIfMissing =
  args.has('--skip') || args.has('--skip-if-missing') || process.env.VITEST_SKIP_IF_MISSING === '1';
const strictMode = args.has('--strict') || !skipIfMissing;

const installInstructions = 'Install with: npm i -D vitest @vitest/coverage-v8 jsdom';
const missingVitestMessage = localVitestCandidates.length === 0
  ? `Vitest was not found in known local paths.`
  : 'Vitest binary not found at any known local path.';

if (!localVitestBinary) {
  if (skipIfMissing) {
    if (strictMode) {
      console.error('Vitest is required to run tests in strict mode.');
      console.error(missingVitestMessage);
      console.error(installInstructions);
      process.exit(1);
    }

    console.log('Skipping tests: Vitest binary not found.');
    console.log(missingVitestMessage);
    console.log(installInstructions);
    process.exit(0);
  }
  console.error('Vitest is required to run tests in strict mode.');
  console.error(missingVitestMessage);
  console.error(installInstructions);
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
