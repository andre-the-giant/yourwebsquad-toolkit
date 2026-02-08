#!/usr/bin/env node

import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import inquirer from "inquirer";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const toolkitRoot = path.resolve(scriptDir, "..");

const starLine = chalk.gray("★".repeat(50));
const errorArt = chalk.red(
  [
    "                               ",
    "       ▄▄▄▄ ▄▄ ▄▄ ▄▄▄▄▄▄ ▄▄▄▄▄ ",
    "      ███▄▄ ██▄██   ██   ██▄▄  ",
    "      ▄▄██▀ ██ ██   ██   ██    ",
    "                               ",
  ].join("\n"),
);
const infoArt = chalk.white(
  [
    "                   ▄▄ ",
    "     ▄▄ ▄▄ ▄████▄  ██ ",
    "     ▀███▀ ██  ██  ██ ",
    "       █   ▀████▀  ▄▄ ",
    "                      ",
  ].join("\n"),
);
const successArt = chalk.green(
  [
    "                                                ",
    "       ▄▄▄▄ ▄▄ ▄▄  ▄▄▄▄  ▄▄▄▄ ▄▄▄▄▄  ▄▄▄▄  ▄▄▄▄ ",
    "      ███▄▄ ██ ██ ██▀▀▀ ██▀▀▀ ██▄▄  ███▄▄ ███▄▄ ",
    "      ▄▄██▀ ▀███▀ ▀████ ▀████ ██▄▄▄ ▄▄██▀ ▄▄██▀ ",
    "                                                ",
  ].join("\n"),
);

function logInfo(msg) {
  console.log(`${starLine}\n${infoArt}\n\n${chalk.cyan(msg)}\n${starLine}`);
}

function logError(msg) {
  console.error(`${starLine}\n${errorArt}\n\n${chalk.red(msg)}\n${starLine}`);
}
function logSuccess(msg) {
  console.log(`${starLine}\n${successArt}\n\n${chalk.green(msg)}\n${starLine}`);
}

function normalizeSlug(value) {
  if (!value) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s/]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeSegment(value) {
  return normalizeSlug(value);
}

function requireNonEmpty(label, value) {
  if (!value || !String(value).trim()) return `${label} is required.`;
  return true;
}

function validateSlug(value) {
  const normalized = normalizeSlug(value);
  if (!normalized) return "Slug is required.";
  if (normalized !== value.trim()) {
    return `Slug should be "${normalized}".`;
  }
  return true;
}

function validateSegment(label, value) {
  const normalized = normalizeSegment(value);
  if (!normalized) return `${label} is required.`;
  if (normalized !== value.trim()) {
    return `${label} should be "${normalized}".`;
  }
  return true;
}

function getContentPath(locale, slug) {
  return path.join(process.cwd(), "public", "content", locale, `${slug}.json`);
}

function getAstroPagePath({ routeType, slug, segmentKey }) {
  if (routeType === "segment") {
    return path.join(
      process.cwd(),
      "src",
      "pages",
      "[lang]",
      `[${segmentKey}Segment]`,
      "index.astro",
    );
  }
  return path.join(
    process.cwd(),
    "src",
    "pages",
    "[lang]",
    slug,
    "index.astro",
  );
}

function getLocalizedHref({ routeType, locale, slug, segmentValue }) {
  if (routeType === "segment") {
    return `/${locale}/${segmentValue}/`;
  }
  return `/${locale}/${slug}/`;
}

function getTemplatePath(routeType) {
  const name =
    routeType === "segment"
      ? "newpage-segment.astro"
      : "newpage-non-segment.astro";
  return path.join(toolkitRoot, "scripts", "templates", name);
}

async function renderTemplate({ routeType, slug, segmentKey }) {
  const templatePath = getTemplatePath(routeType);
  try {
    await fs.access(templatePath);
  } catch (err) {
    throw new Error(`Template not found: ${templatePath}`);
  }
  const raw = await fs.readFile(templatePath, "utf8");
  let rendered = raw.replaceAll("__SLUG__", slug);
  if (routeType === "segment") {
    rendered = rendered.replaceAll("__SEGMENT_KEY__", segmentKey);
  }
  return rendered;
}

function ensureCleanGit() {
  try {
    const status = execSync("git status --porcelain", {
      encoding: "utf8",
    }).trim();
    if (status.length > 0) {
      logError("Git working tree is not clean. Commit or stash changes first.");
      process.exit(1);
    }
  } catch (err) {
    logError("Unable to check git status. Ensure this is a git repository.");
    process.exit(1);
  }
}

async function ensureNotExists(filePath) {
  try {
    await fs.access(filePath);
    throw new Error(`File already exists: ${filePath}`);
  } catch (err) {
    if (err?.code === "ENOENT") return;
    if (String(err?.message || "").startsWith("File already exists")) {
      throw err;
    }
    throw err;
  }
}

async function writeAstroTemplate({ routeType, slug, segmentKey }) {
  const target = getAstroPagePath({ routeType, slug, segmentKey });
  await ensureNotExists(target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const template = await renderTemplate({ routeType, slug, segmentKey });
  await fs.writeFile(target, template, "utf8");
  return target;
}

function buildSeoJson(locale, title, description) {
  return {
    locale,
    seo: {
      title,
      description,
      image: "/assets/og/storefront.jpg",
    },
  };
}

async function writeSeoJsonFiles({
  slug,
  seoTitleFr,
  seoDescFr,
  seoTitleEn,
  seoDescEn,
}) {
  const frPath = getContentPath("fr", slug);
  const enPath = getContentPath("en", slug);
  const existing = [];
  for (const filePath of [frPath, enPath]) {
    try {
      await fs.access(filePath);
      existing.push(filePath);
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
    }
  }
  if (existing.length) {
    const { overwriteContent } = await inquirer.prompt([
      {
        type: "confirm",
        name: "overwriteContent",
        message: `Content JSON already exists (${existing.join(", ")}). Overwrite?`,
        default: false,
      },
    ]);
    if (!overwriteContent) {
      throw new Error("Aborted: content JSON already exists.");
    }
  }
  const frPayload = buildSeoJson("fr", seoTitleFr, seoDescFr);
  const enPayload = buildSeoJson("en", seoTitleEn, seoDescEn);

  await fs.mkdir(path.dirname(frPath), { recursive: true });
  await fs.mkdir(path.dirname(enPath), { recursive: true });

  await fs.writeFile(frPath, `${JSON.stringify(frPayload, null, 2)}\n`, "utf8");
  await fs.writeFile(enPath, `${JSON.stringify(enPayload, null, 2)}\n`, "utf8");

  return { frPath, enPath };
}

async function updateSegments({ segmentKey, segmentFr, segmentEn }) {
  const rootConfigPath = path.join(process.cwd(), "segments.config.mjs");
  const configPath = path.join(
    process.cwd(),
    "src",
    "helpers",
    "segments.config.mjs",
  );
  const legacyPath = path.join(process.cwd(), "src", "helpers", "segments.js");

  async function pathExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async function updateInFile({
    filePath,
    mapRegex,
    mapHeaderRegex,
    mapHeaderLiteral,
    noMapError,
    insertError,
  }) {
    const raw = await fs.readFile(filePath, "utf8");
    const match = raw.match(mapRegex);
    if (!match) {
      throw new Error(noMapError);
    }

    const block = match[0];
    const extractEntry = (text) => {
      const entryMatch = text.match(
        new RegExp(
          `${segmentKey}:\\s*\\{\\s*fr:\\s*\"([^\"]+)\",\\s*en:\\s*\"([^\"]+)\"\\s*\\}`,
        ),
      );
      if (!entryMatch) return null;
      return { fr: entryMatch[1], en: entryMatch[2] };
    };
    const existingKeyRegex = new RegExp(`\\n\\s*${segmentKey}:\\s*\\{`, "m");
    if (existingKeyRegex.test(block)) {
      const existing = extractEntry(block);
      return {
        updated: false,
        path: filePath,
        existing,
      };
    }

    const insertion = `  ${segmentKey}: { fr: \"${segmentFr}\", en: \"${segmentEn}\" },\n`;
    let updatedBlock = block.replace(
      mapHeaderRegex,
      `${mapHeaderLiteral}$1${insertion}`,
    );
    if (updatedBlock === block) {
      updatedBlock = block.replace(
        `${mapHeaderLiteral}\n`,
        `${mapHeaderLiteral}\n${insertion}`,
      );
    }
    if (updatedBlock === block) {
      const inlineEmptyObject = block.match(/^(\s*[^=]+=\s*)\{\s*\};\s*$/);
      if (inlineEmptyObject) {
        updatedBlock = `${inlineEmptyObject[1]}{\n${insertion}};`;
      }
    }
    if (updatedBlock === block) {
      throw new Error(insertError);
    }
    const next = raw.replace(block, updatedBlock);

    await fs.writeFile(filePath, next, "utf8");
    const verify = extractEntry(updatedBlock);
    if (!verify) {
      throw new Error("Failed to verify inserted segment entry.");
    }
    return { updated: true, path: filePath, existing: verify };
  }

  if (await pathExists(rootConfigPath)) {
    return updateInFile({
      filePath: rootConfigPath,
      mapRegex: /export const segments = \{([\s\S]*?)\};/,
      mapHeaderRegex: /export const segments = \{(\r?\n)/,
      mapHeaderLiteral: "export const segments = {",
      noMapError: "Unable to find segments map in segments.config.mjs",
      insertError:
        "Failed to insert new segment. Check segments.config.mjs formatting.",
    });
  }

  if (await pathExists(configPath)) {
    return updateInFile({
      filePath: configPath,
      mapRegex: /export const segments = \{([\s\S]*?)\};/,
      mapHeaderRegex: /export const segments = \{(\r?\n)/,
      mapHeaderLiteral: "export const segments = {",
      noMapError:
        "Unable to find segments map in src/helpers/segments.config.mjs",
      insertError:
        "Failed to insert new segment. Check segments.config.mjs formatting.",
    });
  }

  if (await pathExists(legacyPath)) {
    return updateInFile({
      filePath: legacyPath,
      mapRegex: /const segments = \{([\s\S]*?)\};/,
      mapHeaderRegex: /const segments = \{(\r?\n)/,
      mapHeaderLiteral: "const segments = {",
      noMapError: "Unable to find segments map in src/helpers/segments.js",
      insertError:
        "Failed to insert new segment. Check segments.js formatting.",
    });
  }

  throw new Error(
    "Unable to locate segments map. Expected segments.config.mjs, src/helpers/segments.config.mjs, or src/helpers/segments.js.",
  );
}

async function updateMenu({ locale, navPlacement, label, href }) {
  const menuPath = path.join(
    process.cwd(),
    "public",
    "content",
    locale,
    "menu.json",
  );
  const raw = await fs.readFile(menuPath, "utf8");
  const menu = JSON.parse(raw);

  if (!Array.isArray(menu)) {
    throw new Error(`Menu JSON is not an array: ${menuPath}`);
  }

  const showIn =
    navPlacement === "both"
      ? ["header", "footer"]
      : navPlacement === "none"
        ? []
        : [navPlacement];

  const id = normalizeSlug(label) || normalizeSlug(href) || "new-page";
  const newItem = {
    id,
    label,
    href,
    showIn,
  };

  const existing = menu.find((item) => item.href === href);
  if (existing) {
    const { overwriteMenu } = await inquirer.prompt([
      {
        type: "confirm",
        name: "overwriteMenu",
        message: `Menu entry already exists for ${href} (${locale}). Overwrite label/showIn?`,
        default: false,
      },
    ]);
    if (!overwriteMenu) {
      return { path: menuPath, updated: false };
    }
    existing.label = label;
    existing.showIn = showIn;
  } else {
    menu.push(newItem);
  }

  await fs.writeFile(menuPath, `${JSON.stringify(menu, null, 2)}\n`, "utf8");
  return { path: menuPath, updated: true };
}

async function promptConfig() {
  return inquirer.prompt([
    {
      type: "list",
      name: "routeType",
      message: "Route type?",
      choices: [
        { name: "Segment-based (/[lang]/[segment]/...)", value: "segment" },
        { name: "Non-segment (/[lang]/[slug]/)", value: "non-segment" },
      ],
    },
    {
      type: "input",
      name: "slug",
      message: "Content slug (used for JSON + page):",
      validate: validateSlug,
      filter: (val) => normalizeSlug(val),
    },
    {
      type: "input",
      name: "segmentKey",
      message: "Segment key (internal id):",
      when: (answers) => answers.routeType === "segment",
      validate: (val) => validateSegment("Segment key", val),
      filter: (val) => normalizeSegment(val),
    },
    {
      type: "input",
      name: "segmentFr",
      message: "Segment value (fr):",
      when: (answers) => answers.routeType === "segment",
      validate: (val) => validateSegment("French segment", val),
      filter: (val) => normalizeSegment(val),
    },
    {
      type: "input",
      name: "segmentEn",
      message: "Segment value (en):",
      when: (answers) => answers.routeType === "segment",
      validate: (val) => validateSegment("English segment", val),
      filter: (val) => normalizeSegment(val),
    },
    {
      type: "list",
      name: "navPlacement",
      message: "Navigation placement?",
      choices: [
        { name: "Header", value: "header" },
        { name: "Footer", value: "footer" },
        { name: "Both", value: "both" },
        { name: "None", value: "none" },
      ],
    },
    {
      type: "input",
      name: "labelFr",
      message: "Menu label (fr):",
      when: (answers) => answers.navPlacement !== "none",
      validate: (val) => requireNonEmpty("French label", val),
    },
    {
      type: "input",
      name: "labelEn",
      message: "Menu label (en):",
      when: (answers) => answers.navPlacement !== "none",
      validate: (val) => requireNonEmpty("English label", val),
    },
    {
      type: "input",
      name: "seoTitleFr",
      message: "SEO title (fr):",
      validate: (val) => requireNonEmpty("French SEO title", val),
    },
    {
      type: "input",
      name: "seoDescFr",
      message: "SEO description (fr):",
      validate: (val) => requireNonEmpty("French SEO description", val),
    },
    {
      type: "input",
      name: "seoTitleEn",
      message: "SEO title (en):",
      validate: (val) => requireNonEmpty("English SEO title", val),
    },
    {
      type: "input",
      name: "seoDescEn",
      message: "SEO description (en):",
      validate: (val) => requireNonEmpty("English SEO description", val),
    },
  ]);
}

async function main() {
  ensureCleanGit();
  const answers = await promptConfig();
  const {
    routeType,
    slug,
    segmentKey,
    segmentFr,
    segmentEn,
    navPlacement,
    labelFr,
    labelEn,
    seoTitleFr,
    seoDescFr,
    seoTitleEn,
    seoDescEn,
  } = answers;

  let resolvedSegmentFr = segmentFr;
  let resolvedSegmentEn = segmentEn;
  if (routeType === "segment") {
    const result = await updateSegments({ segmentKey, segmentFr, segmentEn });
    if (!result.updated && result.existing) {
      resolvedSegmentFr = result.existing.fr || segmentFr;
      resolvedSegmentEn = result.existing.en || segmentEn;
    }
  }

  const frHref = getLocalizedHref({
    routeType,
    locale: "fr",
    slug,
    segmentValue: resolvedSegmentFr,
  });
  const enHref = getLocalizedHref({
    routeType,
    locale: "en",
    slug,
    segmentValue: resolvedSegmentEn,
  });

  if (navPlacement !== "none") {
    await updateMenu({
      locale: "fr",
      navPlacement,
      label: labelFr,
      href: frHref,
    });
    await updateMenu({
      locale: "en",
      navPlacement,
      label: labelEn,
      href: enHref,
    });
  }

  await writeSeoJsonFiles({
    slug,
    seoTitleFr,
    seoDescFr,
    seoTitleEn,
    seoDescEn,
  });

  const astroPath = await writeAstroTemplate({ routeType, slug, segmentKey });
  logSuccess("New page created.");
  console.log(
    JSON.stringify(
      {
        routeType,
        slug,
        frHref,
        enHref,
        astroPath,
        contentPaths: [getContentPath("fr", slug), getContentPath("en", slug)],
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  logError(err?.message || "Unexpected error.");
  process.exit(1);
});
