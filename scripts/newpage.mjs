#!/usr/bin/env node

import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
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

function normalizeLocale(value) {
  if (!value) return "";
  return String(value).trim().toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fieldName(prefix, locale) {
  return `${prefix}_${locale.replace(/[^a-z0-9]/gi, "_")}`;
}

function localeLabel(locale, defaultLocale) {
  return locale === defaultLocale ? `${locale}, default` : locale;
}

function extractLocaleConfig(i18nConfig) {
  if (!i18nConfig || typeof i18nConfig !== "object") return null;

  let locales = [];
  const rawLocales = i18nConfig.locales;
  if (Array.isArray(rawLocales)) {
    locales = rawLocales
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          if (typeof entry.path === "string") return entry.path;
          if (typeof entry.code === "string") return entry.code;
          if (
            Array.isArray(entry.codes) &&
            typeof entry.codes[0] === "string"
          ) {
            return entry.codes[0];
          }
        }
        return "";
      })
      .map(normalizeLocale);
  } else if (rawLocales && typeof rawLocales === "object") {
    locales = Object.keys(rawLocales).map(normalizeLocale);
  }

  locales = unique(locales);
  if (!locales.length) return null;

  let defaultLocale = normalizeLocale(i18nConfig.defaultLocale);
  if (!defaultLocale || !locales.includes(defaultLocale)) {
    defaultLocale = locales.includes("en") ? "en" : locales[0];
  }

  const prefixDefaultLocale = i18nConfig.routing?.prefixDefaultLocale !== false;

  return { locales, defaultLocale, prefixDefaultLocale };
}

async function resolveLocaleConfigFromAstroConfig() {
  const configPath = path.join(process.cwd(), "astro.config.mjs");
  try {
    await fs.access(configPath);
  } catch {
    return null;
  }

  const previousSiteUrl = process.env.SITE_URL;
  const previousStagingUrl = process.env.STAGING_URL;
  const previousNodeEnv = process.env.NODE_ENV;

  if (!process.env.SITE_URL) process.env.SITE_URL = "https://example.com/";
  if (!process.env.STAGING_URL) process.env.STAGING_URL = process.env.SITE_URL;
  if (!process.env.NODE_ENV) process.env.NODE_ENV = "development";

  try {
    const configModule = await import(
      `${pathToFileURL(configPath).href}?v=${Date.now()}`
    );
    let rawConfig = configModule?.default;
    if (typeof rawConfig === "function") {
      rawConfig = await rawConfig({
        command: "build",
        mode: process.env.NODE_ENV || "development",
      });
    }
    const localeConfig = extractLocaleConfig(rawConfig?.i18n);
    if (!localeConfig) return null;
    return { ...localeConfig, source: "astro.config.mjs" };
  } catch {
    return null;
  } finally {
    if (previousSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previousSiteUrl;
    if (previousStagingUrl === undefined) delete process.env.STAGING_URL;
    else process.env.STAGING_URL = previousStagingUrl;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

async function resolveLocaleConfigFromContent() {
  const contentRoot = path.join(process.cwd(), "public", "content");
  let entries = [];
  try {
    entries = await fs.readdir(contentRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const localePattern = /^[a-z]{2}(?:-[a-z0-9]{2,8})*$/i;
  const locales = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => normalizeLocale(entry.name))
    .filter((entry) => localePattern.test(entry));

  if (!locales.length) return null;

  const uniqueLocales = unique(locales);
  return {
    locales: uniqueLocales,
    defaultLocale: uniqueLocales.includes("en") ? "en" : uniqueLocales[0],
    prefixDefaultLocale: true,
    source: "public/content/* fallback",
  };
}

async function resolveLocaleConfig() {
  const fromAstro = await resolveLocaleConfigFromAstroConfig();
  if (fromAstro) return fromAstro;

  const fromContent = await resolveLocaleConfigFromContent();
  if (fromContent) return fromContent;

  return {
    locales: ["en"],
    defaultLocale: "en",
    prefixDefaultLocale: true,
    source: "default fallback",
  };
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

function supportsRootRoutes({ locales, prefixDefaultLocale }) {
  return locales.length === 1 && prefixDefaultLocale === false;
}

function resolveRouteScope({ locales, prefixDefaultLocale }) {
  if (locales.length === 1 && prefixDefaultLocale === false) return "root";
  if (locales.length > 1) return "localized";
  return null;
}

function getAstroPagePath({ routeType, routeScope, slug, segmentKey }) {
  if (routeType === "segment") {
    return path.join(
      process.cwd(),
      "src",
      "pages",
      routeScope === "localized" ? "[lang]" : "",
      `[${segmentKey}Segment]`,
      "index.astro",
    );
  }
  return path.join(
    process.cwd(),
    "src",
    "pages",
    routeScope === "localized" ? "[lang]" : "",
    slug,
    "index.astro",
  );
}

function getPageHref({ routeType, routeScope, locale, slug, segmentValue }) {
  if (routeType === "segment") {
    return routeScope === "localized"
      ? `/${locale}/${segmentValue}/`
      : `/${segmentValue}/`;
  }
  return routeScope === "localized" ? `/${locale}/${slug}/` : `/${slug}/`;
}

function getTemplatePath(routeType, routeScope) {
  const name =
    routeType === "segment"
      ? routeScope === "localized"
        ? "newpage-segment.astro"
        : "newpage-segment-root.astro"
      : routeScope === "localized"
        ? "newpage-non-segment.astro"
        : "newpage-non-segment-root.astro";
  return path.join(toolkitRoot, "scripts", "templates", name);
}

async function renderTemplate({
  routeType,
  routeScope,
  slug,
  segmentKey,
  locales,
  defaultLocale,
}) {
  const templatePath = getTemplatePath(routeType, routeScope);
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
  rendered = rendered.replaceAll("__LOCALES__", JSON.stringify(locales));
  rendered = rendered.replaceAll("__DEFAULT_LOCALE__", defaultLocale);
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

async function writeAstroTemplate({
  routeType,
  routeScope,
  slug,
  segmentKey,
  locales,
  defaultLocale,
}) {
  const target = getAstroPagePath({ routeType, routeScope, slug, segmentKey });
  await ensureNotExists(target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const template = await renderTemplate({
    routeType,
    routeScope,
    slug,
    segmentKey,
    locales,
    defaultLocale,
  });
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

async function writeSeoJsonFiles({ slug, locales, seoByLocale }) {
  const paths = locales.map((locale) => getContentPath(locale, slug));
  const existing = [];
  for (const filePath of paths) {
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
  for (const locale of locales) {
    const filePath = getContentPath(locale, slug);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const seo = seoByLocale[locale];
    const payload = buildSeoJson(locale, seo.title, seo.description);
    await fs.writeFile(
      filePath,
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
  }

  return { paths };
}

async function updateSegments({ segmentKey, localeSegments }) {
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
    const segmentKeyEscaped = escapeRegExp(segmentKey);
    const extractEntry = (text) => {
      const entryMatch = text.match(
        new RegExp(`${segmentKeyEscaped}:\\s*\\{([\\s\\S]*?)\\}`, "m"),
      );
      if (!entryMatch) return null;
      const localeMapRaw = entryMatch[1];
      const localeMap = {};
      const localeRegex = /([a-zA-Z0-9_-]+)\s*:\s*"([^"]+)"/g;
      let localeMatch;
      while ((localeMatch = localeRegex.exec(localeMapRaw)) !== null) {
        localeMap[localeMatch[1]] = localeMatch[2];
      }
      if (!Object.keys(localeMap).length) return null;
      return localeMap;
    };
    const existingKeyRegex = new RegExp(
      `\\n\\s*${segmentKeyEscaped}:\\s*\\{`,
      "m",
    );
    if (existingKeyRegex.test(block)) {
      const existing = extractEntry(block);
      return {
        updated: false,
        path: filePath,
        existing,
      };
    }

    const serializedLocales = Object.entries(localeSegments)
      .map(([locale, value]) => `${locale}: "${value}"`)
      .join(", ");
    const insertion = `  ${segmentKey}: { ${serializedLocales} },\n`;
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
  let raw;
  try {
    raw = await fs.readFile(menuPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") {
      return {
        path: menuPath,
        updated: false,
        skipped: true,
        reason: "missing-menu-file",
      };
    }
    throw err;
  }
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

async function warnIfHeaderLocaleSwitchIsNotSegmentAware() {
  const candidates = [
    path.join(process.cwd(), "src", "components", "layout", "Header.astro"),
    path.join(process.cwd(), "src", "components", "Header.astro"),
  ];

  for (const candidate of candidates) {
    let raw;
    try {
      raw = await fs.readFile(candidate, "utf8");
    } catch (err) {
      if (err?.code === "ENOENT") continue;
      throw err;
    }

    if (!raw.includes("LocaleSwitch")) return;
    if (raw.includes("mapSegmentToLocale(")) return;

    console.log(
      chalk.yellow(
        [
          `Warning: ${candidate} uses LocaleSwitch but does not map localized segment values.`,
          "Language switching can break on segment routes.",
          "Add @toolkit/segments createSegmentHelpers + mapSegmentToLocale in Header.astro.",
        ].join(" "),
      ),
    );
    return;
  }
}

async function promptConfig(localeConfig) {
  const { locales, defaultLocale } = localeConfig;
  const canUseSegmentRoutes = locales.length > 1;
  const questions = [
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
  ];

  for (const locale of locales) {
    questions.push({
      type: "input",
      name: fieldName("segmentValue", locale),
      message: `Segment value (${localeLabel(locale, defaultLocale)}):`,
      when: (answers) => answers.routeType === "segment",
      validate: (val) => validateSegment(`Segment (${locale})`, val),
      filter: (val) => normalizeSegment(val),
    });
  }

  for (const locale of locales) {
    questions.push({
      type: "input",
      name: fieldName("menuLabel", locale),
      message: `Menu label (${localeLabel(locale, defaultLocale)}):`,
      when: (answers) => answers.navPlacement !== "none",
      validate: (val) => requireNonEmpty(`Menu label (${locale})`, val),
    });
  }

  for (const locale of locales) {
    questions.push({
      type: "input",
      name: fieldName("seoTitle", locale),
      message: `SEO title (${localeLabel(locale, defaultLocale)}):`,
      validate: (val) => requireNonEmpty(`SEO title (${locale})`, val),
    });
    questions.push({
      type: "input",
      name: fieldName("seoDescription", locale),
      message: `SEO description (${localeLabel(locale, defaultLocale)}):`,
      validate: (val) => requireNonEmpty(`SEO description (${locale})`, val),
    });
  }

  if (canUseSegmentRoutes) {
    questions.unshift({
      type: "list",
      name: "routeType",
      message: "Route type?",
      choices: [
        { name: "Segment-based (/[lang]/[segment]/...)", value: "segment" },
        { name: "Non-segment (/[lang]/[slug]/)", value: "non-segment" },
      ],
    });
  }

  const answers = await inquirer.prompt(questions);
  return {
    routeType: canUseSegmentRoutes ? answers.routeType : "non-segment",
    ...answers,
  };
}

async function main() {
  ensureCleanGit();
  const localeConfig = await resolveLocaleConfig();
  const { locales, defaultLocale, source, prefixDefaultLocale } = localeConfig;
  const routeScope = resolveRouteScope(localeConfig);
  logInfo(
    `Locales detected from ${source}: ${locales.join(", ")} (default: ${defaultLocale}, prefixDefaultLocale: ${prefixDefaultLocale})`,
  );

  if (!routeScope) {
    throw new Error(
      "Unsupported locale routing configuration. Expected either a single-locale site with prefixDefaultLocale: false, or a multilingual site.",
    );
  }

  const answers = await promptConfig(localeConfig);
  const { routeType, slug, segmentKey, navPlacement } = answers;

  if (routeType === "segment" && locales.length < 2) {
    throw new Error(
      "Segment routes require a multilingual site. Add at least two locales to use localized segments.",
    );
  }

  const segmentByLocale = {};
  const labelByLocale = {};
  const seoByLocale = {};
  for (const locale of locales) {
    const segmentValueKey = fieldName("segmentValue", locale);
    const menuLabelKey = fieldName("menuLabel", locale);
    const seoTitleKey = fieldName("seoTitle", locale);
    const seoDescriptionKey = fieldName("seoDescription", locale);

    if (routeType === "segment") {
      segmentByLocale[locale] = answers[segmentValueKey];
    }
    if (navPlacement !== "none") {
      labelByLocale[locale] = answers[menuLabelKey];
    }
    seoByLocale[locale] = {
      title: answers[seoTitleKey],
      description: answers[seoDescriptionKey],
    };
  }

  let resolvedSegmentByLocale = { ...segmentByLocale };
  if (routeType === "segment") {
    const result = await updateSegments({
      segmentKey,
      localeSegments: segmentByLocale,
    });
    if (!result.updated && result.existing) {
      resolvedSegmentByLocale = { ...segmentByLocale, ...result.existing };
    }
  }

  const hrefByLocale = {};
  for (const locale of locales) {
    hrefByLocale[locale] = getPageHref({
      routeType,
      routeScope,
      locale,
      slug,
      segmentValue:
        resolvedSegmentByLocale[locale] ||
        resolvedSegmentByLocale[defaultLocale],
    });
  }

  if (navPlacement !== "none") {
    const menuResults = [];
    for (const locale of locales) {
      const menuResult = await updateMenu({
        locale,
        navPlacement,
        label: labelByLocale[locale] || labelByLocale[defaultLocale],
        href: hrefByLocale[locale],
      });
      menuResults.push(menuResult);
    }
    const skippedMenus = menuResults.filter((result) => result.skipped);
    if (skippedMenus.length) {
      skippedMenus.forEach((result) => {
        console.log(
          chalk.yellow(`Skipping menu update (missing file): ${result.path}`),
        );
      });
    }
  }

  const contentResult = await writeSeoJsonFiles({ slug, locales, seoByLocale });

  const astroPath = await writeAstroTemplate({
    routeType,
    routeScope,
    slug,
    segmentKey,
    locales,
    defaultLocale,
  });
  if (routeType === "segment" && locales.length > 1) {
    await warnIfHeaderLocaleSwitchIsNotSegmentAware();
  }
  logSuccess("New page created.");
  const frHref = hrefByLocale.fr || null;
  const enHref = hrefByLocale.en || null;
  console.log(
    JSON.stringify(
      {
        routeType,
        routeScope,
        slug,
        locales,
        defaultLocale,
        frHref,
        enHref,
        hrefByLocale,
        astroPath,
        contentPaths: contentResult.paths,
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
