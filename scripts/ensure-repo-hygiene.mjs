#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, extname } from 'node:path';

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
const transportConflictMarkers = [];

const transportCriticalPrefixes = ['src/', 'tests/'];
const transportCriticalExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts']);
const conflictMarkerRegex = /^\s*(?:<<<<<<<(?:\s|$)|=======(?:\s|$)|>>>>>>>(?:\s|$))/;

const isTransportCriticalFile = (filePath) => {
  if (!transportCriticalPrefixes.some((prefix) => filePath.startsWith(prefix))) {
    return false;
  }

  return transportCriticalExtensions.has(extname(filePath));
};

for (const trackedFile of trackedFiles) {
  if (trackedFile === 'node_modules' || trackedFile.startsWith('node_modules/')) {
    trackedNodeModules.push(trackedFile);
    continue;
  }

  if (!isTransportCriticalFile(trackedFile)) {
    continue;
  }

  const fullPath = resolve(process.cwd(), trackedFile);

  if (!existsSync(fullPath)) {
    continue;
  }

  const contents = readFileSync(fullPath, 'utf8');
  const lines = contents.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];

    if (conflictMarkerRegex.test(line)) {
      transportConflictMarkers.push({
        file: trackedFile,
        line: lineIndex + 1,
        text: line.trim(),
      });
    }
  }
}

if (trackedNodeModules.length > 0) {
  console.error('Repository hygiene failed: tracked node_modules content detected.');
  for (const file of trackedNodeModules) {
    console.error(` - ${file}`);
  }
}

if (transportConflictMarkers.length > 0) {
  console.error('Repository hygiene failed: unresolved conflict markers detected in transport-critical files.');
  for (const marker of transportConflictMarkers) {
    console.error(` - ${marker.file}:${marker.line} :: ${marker.text}`);
  }
}

if (trackedNodeModules.length > 0 || transportConflictMarkers.length > 0) {
  process.exit(1);
}

console.log('Repository hygiene check passed.');
