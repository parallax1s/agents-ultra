#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const lsFilesResult = spawnSync('git', ['ls-files', '-z'], {
  encoding: 'utf8',
});

if (lsFilesResult.error) {
  throw lsFilesResult.error;
}

if (typeof lsFilesResult.status !== 'number' || lsFilesResult.status !== 0) {
  if (lsFilesResult.stderr) {
    process.stderr.write(lsFilesResult.stderr);
  } else {
    console.error('Failed to list tracked files.');
  }
  process.exit(1);
}

const trackedFiles = lsFilesResult.stdout
  .split('\0')
  .map((file) => file.trim())
  .filter(Boolean);

const trackedNodeModules = [];
const trackedConflictFiles = [];

for (const trackedFile of trackedFiles) {
  if (trackedFile === 'node_modules' || trackedFile.startsWith('node_modules/')) {
    trackedNodeModules.push(trackedFile);
    continue;
  }

  const fullPath = resolve(process.cwd(), trackedFile);

  if (!existsSync(fullPath)) {
    continue;
  }

  const contents = readFileSync(fullPath, 'utf8');
  if (contents.includes('<<<<<<<') || contents.includes('=======') || contents.includes('>>>>>>>')) {
    trackedConflictFiles.push(trackedFile);
  }
}

if (trackedNodeModules.length > 0) {
  console.error('Repository hygiene failed: tracked node_modules content detected.');
  for (const file of trackedNodeModules) {
    console.error(` - ${file}`);
  }
}

if (trackedConflictFiles.length > 0) {
  console.error('Repository hygiene failed: conflict markers detected in tracked files.');
  for (const file of trackedConflictFiles) {
    console.error(` - ${file}`);
  }
}

if (trackedNodeModules.length > 0 || trackedConflictFiles.length > 0) {
  process.exit(1);
}

console.log('Repository hygiene check passed.');
