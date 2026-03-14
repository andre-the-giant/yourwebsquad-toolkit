/**
 * Renderer artifact manifest shape:
 * {
 *   format: string,
 *   runId: string,
 *   rootDir: string,
 *   files: Array<{ path: string, relPath: string }>
 * }
 */

export function createArtifactManifest({ format, runId, rootDir, files = [] }) {
  return {
    format: String(format || ""),
    runId: String(runId || ""),
    rootDir: String(rootDir || ""),
    files: Array.isArray(files) ? files : [],
  };
}

