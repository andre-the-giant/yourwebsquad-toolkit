import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");
const requireFromToolkit = createRequire(import.meta.url);

const COMMANDS = {
  clean: "scripts/clean.mjs",
  quality: {
    run: "scripts/run-quality-suite.mjs",
    a11y: "scripts/pa11y-crawl-and-test.mjs",
    seo: "scripts/seo-audit.mjs",
    links: "scripts/link-check.mjs",
    jsonld: "scripts/jsonld-validate.mjs",
    comment: "scripts/post-quality-comment.mjs",
  },
  update: {
    components: "scripts/update-components.mjs",
    toolkit: "scripts/update-toolkit.mjs",
  },
};

function printHelp() {
  console.log("Usage:");
  console.log("  yws-toolkit clean [-- <args>]");
  console.log("  yws-toolkit format [--check] [-- <prettier args>]");
  console.log(
    "  yws-toolkit quality <run|a11y|seo|links|jsonld|comment> [-- <args>]",
  );
  console.log("  yws-toolkit update <components|toolkit> [-- <args>]");
}

function resolveScript(mainCommand, subCommand) {
  const selected = COMMANDS[mainCommand];
  if (!selected) return null;
  if (typeof selected === "string") return selected;
  if (!subCommand) return null;
  return selected[subCommand] || null;
}

function runScript(scriptRelPath, args) {
  const scriptPath = path.join(packageRoot, scriptRelPath);
  if (!fs.existsSync(scriptPath)) {
    console.error(
      `Script not available yet in toolkit: ${scriptRelPath}. ` +
        "This command will work once that script is migrated.",
    );
    return 1;
  }

  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });

  return result.status ?? 1;
}

function runFormat(args) {
  let prettierBin;
  let astroPlugin;
  try {
    prettierBin = requireFromToolkit.resolve("prettier/bin/prettier.cjs");
    astroPlugin = requireFromToolkit.resolve("prettier-plugin-astro");
  } catch (err) {
    console.error(
      `Unable to resolve formatter dependencies from toolkit: ${err.message}`,
    );
    return 1;
  }

  const userArgs = Array.isArray(args) ? [...args] : [];
  const hasUserTarget = userArgs.some((arg) => arg && !arg.startsWith("-"));
  const forwarded = [...userArgs];
  const hasCheck = forwarded.includes("--check");
  const hasWrite = forwarded.includes("--write");
  if (!hasCheck && !hasWrite) {
    forwarded.unshift("--write");
  }
  if (!forwarded.includes("--plugin")) {
    forwarded.unshift(astroPlugin);
    forwarded.unshift("--plugin");
  }
  if (!hasUserTarget) {
    forwarded.push(".");
  }

  const result = spawnSync(process.execPath, [prettierBin, ...forwarded], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });
  return result.status ?? 1;
}

export function runCli(argv = []) {
  const [mainCommand, maybeSubCommand, ...rest] = argv;

  if (!mainCommand || mainCommand === "-h" || mainCommand === "--help") {
    printHelp();
    return;
  }

  if (mainCommand === "clean") {
    const exitCode = runScript(
      resolveScript("clean"),
      [maybeSubCommand, ...rest].filter(Boolean),
    );
    if (exitCode !== 0) process.exit(exitCode);
    return;
  }

  if (mainCommand === "format") {
    const exitCode = runFormat([maybeSubCommand, ...rest].filter(Boolean));
    if (exitCode !== 0) process.exit(exitCode);
    return;
  }

  if (mainCommand === "quality" || mainCommand === "update") {
    if (
      !maybeSubCommand ||
      maybeSubCommand === "-h" ||
      maybeSubCommand === "--help"
    ) {
      printHelp();
      process.exit(1);
      return;
    }
    const scriptRelPath = resolveScript(mainCommand, maybeSubCommand);
    if (!scriptRelPath) {
      console.error(
        `Unknown subcommand for "${mainCommand}": ${maybeSubCommand}`,
      );
      printHelp();
      process.exit(1);
      return;
    }
    const exitCode = runScript(scriptRelPath, rest);
    if (exitCode !== 0) process.exit(exitCode);
    return;
  }

  console.error(`Unknown command: ${mainCommand}`);
  printHelp();
  process.exit(1);
}
