#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const publicConfig = join(scriptDir, "npm-public.npmrc");
const publicGlobalConfig = join(scriptDir, "npm-global-public.npmrc");
const env = { ...process.env };

for (const key of Object.keys(env)) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  const npmCredential =
    normalized.startsWith("npmconfig") &&
    (normalized.includes("auth") ||
      normalized.includes("password") ||
      normalized.endsWith("username") ||
      normalized.endsWith("otp") ||
      normalized.endsWith("cert") ||
      normalized.endsWith("key"));
  if (
    normalized === "npmtoken" ||
    normalized === "nodeauthtoken" ||
    normalized.includes("authtoken") ||
    npmCredential ||
    normalized === "npmconfiguserconfig" ||
    normalized === "npmconfigglobalconfig"
  ) {
    delete env[key];
  }
}
env.NPM_CONFIG_USERCONFIG = publicConfig;
env.NPM_CONFIG_GLOBALCONFIG = publicGlobalConfig;

let command;
let prefixArgs;
if (process.env.FPP_NPM_TEST_COMMAND && process.env.FPP_NPM_TEST_SCRIPT) {
  command = process.env.FPP_NPM_TEST_COMMAND;
  prefixArgs = [process.env.FPP_NPM_TEST_SCRIPT];
} else if (process.platform === "win32") {
  const npmCli = join(
    dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  if (!existsSync(npmCli)) {
    console.error(`ERROR: npm CLI not found at ${npmCli}`);
    process.exit(2);
  }
  command = process.execPath;
  prefixArgs = [npmCli];
} else {
  command = "npm";
  prefixArgs = [];
}

delete env.FPP_NPM_TEST_COMMAND;
delete env.FPP_NPM_TEST_SCRIPT;
const result = spawnSync(command, [...prefixArgs, ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
  shell: false,
});
process.exit(result.status ?? 1);
