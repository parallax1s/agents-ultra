#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const localPlaywrightBinary = resolve(process.cwd(), "node_modules/.bin/playwright");

if (!existsSync(localPlaywrightBinary)) {
  console.log("Playwright not installed locally; skipping e2e suite.");
  console.log("Install with: npm i -D @playwright/test && npx playwright install --with-deps");
  process.exit(0);
}

const result = spawnSync(
  `${localPlaywrightBinary} test --config=playwright.config.ts`,
  {
    shell: true,
    stdio: "pipe",
    encoding: "utf8",
  },
);

if (result.stdout) {
  process.stdout.write(result.stdout);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.error) {
  throw result.error;
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
