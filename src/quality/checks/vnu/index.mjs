import { defineQualityCheck } from "../../core/quality-check.mjs";
import { collectVnuFromReportDir } from "./collect.mjs";
import { normalizeVnuPayload } from "./normalize.mjs";
import { summarizeVnuPayload } from "./summarize.mjs";

export const vnuCheck = defineQualityCheck({
  id: "vnu",
  async collect(context = {}) {
    return collectVnuFromReportDir(context.reportDir, {
      logPath: context.logPath,
    });
  },
  async normalize(raw, context = {}) {
    return normalizeVnuPayload(raw, {
      selected: context.selected !== false,
      failed: Boolean(context.failed),
    });
  },
  async summarize(normalized) {
    return summarizeVnuPayload(normalized);
  },
  capabilities: {
    supportsRemote: true,
    supportsLocalBuild: true,
  },
});
