#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const mode = process.argv.slice(2);
const strictMode = mode.includes("--strict");
const skipMissing = mode.includes("--skip-missing") || mode.includes("--skip");

const optionalMode = strictMode || !skipMissing;
const strictOrSkipArg = strictMode ? "--strict" : "--skip-if-missing";

const steps = [
  {
    label: "Typecheck",
    command: "npm",
    args: ["run", "typecheck"],
    skipIfUnavailable: false,
  },
  {
    label: "Build",
    command: "npm",
    args: ["run", "build"],
    skipIfUnavailable: false,
  },
  {
    label: "Movement regression smoke",
    command: "node",
    args: [
      "scripts/ensure-vitest-or-skip.mjs",
      optionalMode ? strictOrSkipArg : "--skip-if-missing",
      "tests/map.test.ts",
      "tests/pipeline.test.ts",
      "tests/sim-compat.test.ts",
      "tests/sim.test.ts",
    ],
    skipIfUnavailable: true,
  },
  {
    label: "E2E smoke",
    command: "node",
    args: [
      "scripts/ensure-playwright-or-skip.mjs",
      optionalMode ? strictOrSkipArg : "--skip-if-missing",
    ],
    skipIfUnavailable: true,
  },
];

const runStep = ({ label, command, args }) => {
  console.log(`\n[agent-workflow] running: ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
};

const runSteps = () => {
  for (const step of steps) {
    const status = runStep(step);
    if (status !== 0) {
      if (!strictMode) {
        console.log(`[agent-workflow] skipped or failed in non-strict mode for: ${step.label}`);
        return status;
      }
      process.exit(status);
    }
  }
  return 0;
};

if (!optionalMode) {
  console.log("[agent-workflow] optional mode enabled");
  console.log("  - strict tooling is skipped when Playwright/Vitest are unavailable");
}

const status = runSteps();
if (status !== 0 && strictMode) {
  process.exit(status);
}

if (status !== 0) {
  process.exit(status);
}

console.log("\n[agent-workflow] agent smoke workflow complete.");
process.exit(0);
