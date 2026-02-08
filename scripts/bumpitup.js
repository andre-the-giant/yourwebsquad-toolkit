#!/usr/bin/env node
import fs from "fs/promises";
import { execa } from "execa";
import path from "path";
import process from "process";
import inquirer from "inquirer";
import chalk from "chalk";

const repoRoot = process.cwd();
const pkgPath = path.join(repoRoot, "package.json");

function logInfo(msg) {
  console.log(chalk.cyan(msg));
}

function logSuccess(msg) {
  console.log(chalk.green(msg));
}

function logError(msg) {
  console.error(chalk.red(msg));
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(filePath, serialized, "utf8");
}

async function runQuiet(cmd, args, opts = {}) {
  try {
    await execa(cmd, args, { stdio: "ignore", ...opts });
  } catch (err) {
    // Rerun to surface output on failure
    const { stdout = "", stderr = "" } = await execa(cmd, args, { ...opts, reject: false });
    const out = [stdout, stderr].filter(Boolean).join("\n").trim();
    throw new Error(out || err.shortMessage || err.message);
  }
}

function nextVersions(current) {
  const [major, minor, patch] = current.split(".").map((n) => Number(n));
  return {
    patch: `${major}.${minor}.${patch + 1}`,
    minor: `${major}.${minor + 1}.0`,
    major: `${major + 1}.0.0`
  };
}

async function ensureOnBranch(target = "main") {
  const { stdout } = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (stdout.trim() !== target) {
    throw new Error(`Not on ${target} branch (current: ${stdout.trim()}).`);
  }
}

async function ensureCleanGit() {
  const { stdout } = await execa("git", ["status", "--porcelain"]);
  if (stdout.trim()) {
    throw new Error("Working tree is not clean. Commit or stash changes first.");
  }
}

async function ensureRemote() {
  const { stdout } = await execa("git", ["remote"]);
  if (!stdout.trim()) {
    throw new Error("No git remote configured. Add a remote before tagging/pushing.");
  }
}

async function main() {
  try {
    const pkg = await readJson(pkgPath);
    const current = pkg.version;
    const candidates = nextVersions(current);

    const { versionChoice } = await inquirer.prompt([
      {
        type: "list",
        name: "versionChoice",
        message: `Current version is ${current}. Bump to:`,
        choices: [
          { name: `Patch (${candidates.patch})`, value: candidates.patch },
          { name: `Minor (${candidates.minor})`, value: candidates.minor },
          { name: `Major (${candidates.major})`, value: candidates.major }
        ]
      }
    ]);

    await ensureRemote();
    await ensureOnBranch("main");
    await ensureCleanGit();

    const { note } = await inquirer.prompt([
      {
        type: "input",
        name: "note",
        message: "Tag notes (short sentence):",
        default: ""
      }
    ]);

    pkg.version = versionChoice;
    await writeJson(pkgPath, pkg);

    logInfo("Running format...");
    await runQuiet("npm", ["run", "format"]);

    logInfo("Running build...");
    await runQuiet("npm", ["run", "build"]);

    const trimmedNote = note.trim();
    const commitMsg = trimmedNote
      ? `chore: release v${versionChoice} - ${trimmedNote}`
      : `chore: release v${versionChoice}`;
    const tagMsg = trimmedNote ? `v${versionChoice} - ${trimmedNote}` : `v${versionChoice}`;

    await execa("git", ["add", "-u"]);
    await execa("git", ["commit", "-m", commitMsg]);

    await execa("git", ["tag", "-a", `v${versionChoice}`, "-m", tagMsg]);
    await execa("git", ["push"]);
    await execa("git", ["push", "origin", `v${versionChoice}`]);

    logSuccess(`Bumped to v${versionChoice} successfully.`);
  } catch (err) {
    logError(err.message || String(err));
    process.exit(1);
  }
}

main();
