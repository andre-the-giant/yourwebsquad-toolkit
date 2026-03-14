/**
 * @typedef {Object} QualityCheck
 * @property {string} id Stable check identifier (for example: "lighthouse").
 * @property {(context: object) => Promise<object>} collect Produces raw check artifacts.
 * @property {(raw: object, context: object) => Promise<object>} normalize Maps raw output to canonical dataset payload.
 * @property {(normalized: object, context: object) => Promise<object>} summarize Produces compact summary for CLI/index usage.
 * @property {Object<string, unknown>} [capabilities] Optional capability flags used by orchestrator selection logic.
 */

export function defineQualityCheck(check) {
  if (!check || typeof check !== "object") {
    throw new Error("Quality check definition must be an object.");
  }
  if (!check.id || typeof check.id !== "string") {
    throw new Error("Quality check definition requires a string id.");
  }
  for (const method of ["collect", "normalize", "summarize"]) {
    if (typeof check[method] !== "function") {
      throw new Error(`Quality check "${check.id}" is missing ${method}().`);
    }
  }
  return Object.freeze({ ...check });
}
