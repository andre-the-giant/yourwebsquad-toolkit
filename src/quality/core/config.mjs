import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CHECK_IDS = [
  "lighthouse",
  "pa11y",
  "seo",
  "links",
  "jsonld",
  "security",
  "vnu",
];

function asArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string");
}

function normalizeChecks(raw) {
  const checks = raw && typeof raw === "object" ? raw : {};
  const enabled =
    Array.isArray(checks.enabled) && checks.enabled.length
      ? asArray(checks.enabled).filter((id) => CHECK_IDS.includes(id))
      : null;
  const disabled = asArray(checks.disabled).filter((id) =>
    CHECK_IDS.includes(id),
  );
  const order = asArray(checks.order).filter((id) => CHECK_IDS.includes(id));

  const rawThresholds =
    checks.thresholds && typeof checks.thresholds === "object"
      ? checks.thresholds
      : {};
  const thresholds = {};
  for (const [checkId, value] of Object.entries(rawThresholds)) {
    if (!CHECK_IDS.includes(checkId)) continue;
    if (!value || typeof value !== "object") continue;
    const normalized = {};
    for (const [metric, metricValue] of Object.entries(value)) {
      if (!Number.isFinite(metricValue)) continue;
      normalized[metric] = Number(metricValue);
    }
    thresholds[checkId] = normalized;
  }

  const rawOptions =
    checks.options && typeof checks.options === "object" ? checks.options : {};
  const options = {};
  for (const [checkId, value] of Object.entries(rawOptions)) {
    if (!CHECK_IDS.includes(checkId)) continue;
    if (!value || typeof value !== "object") continue;
    options[checkId] = value;
  }

  return { enabled, disabled, order, thresholds, options };
}

function normalizeConfig(raw) {
  const config = raw && typeof raw === "object" ? raw : {};
  return {
    checks: normalizeChecks(config.checks),
  };
}

async function readConfigFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  if (filePath.endsWith(".json")) {
    const text = fs.readFileSync(filePath, "utf8");
    return JSON.parse(text);
  }
  const module = await import(pathToFileURL(filePath).href);
  return module?.default || module?.config || null;
}

export async function loadQualityConfig(cwd = process.cwd()) {
  const files = [
    "quality.config.json",
    "quality.config.mjs",
    "quality.config.cjs",
  ];

  for (const name of files) {
    const fullPath = path.join(cwd, name);
    try {
      const value = await readConfigFile(fullPath);
      if (!value) continue;
      return { path: fullPath, ...normalizeConfig(value) };
    } catch (error) {
      throw new Error(
        `Failed to load ${name}: ${error?.message || String(error)}`,
      );
    }
  }
  return { path: null, ...normalizeConfig({}) };
}

export function applyQualityConfigToSelection(
  selectedChecks,
  config,
  availability,
) {
  const selection = { ...selectedChecks };
  const checks = config?.checks || {};
  const enabled = checks.enabled;
  const disabled = new Set(checks.disabled || []);

  if (enabled && enabled.length) {
    for (const id of CHECK_IDS) {
      selection[id] = enabled.includes(id);
    }
  }

  for (const id of disabled) {
    selection[id] = false;
  }

  // Never allow checks that are unavailable for the selected target.
  for (const id of CHECK_IDS) {
    if (availability?.[id]?.enabled === false) {
      selection[id] = false;
    }
  }

  return selection;
}

export function orderedSelectedChecks(selectedChecks, config) {
  const checks = config?.checks || {};
  const preferred = Array.isArray(checks.order) ? checks.order : [];
  const selected = CHECK_IDS.filter((id) => Boolean(selectedChecks?.[id]));
  const ordered = [];
  for (const id of preferred) {
    if (selected.includes(id)) ordered.push(id);
  }
  for (const id of selected) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}
