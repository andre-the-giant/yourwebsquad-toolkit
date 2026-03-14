import { defineQualityCheck } from "./quality-check.mjs";

const checks = new Map();

export function registerQualityCheck(check) {
  const normalized = defineQualityCheck(check);
  checks.set(normalized.id, normalized);
  return normalized;
}

export function getQualityCheck(id) {
  return checks.get(id) || null;
}

export function listQualityChecks() {
  return Array.from(checks.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function clearQualityCheckRegistry() {
  checks.clear();
}

