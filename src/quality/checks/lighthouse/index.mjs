import { defineQualityCheck } from "../../core/quality-check.mjs";
import { collectLighthouseFromReportDir } from "./collect.mjs";
import { normalizeLighthousePayload } from "./normalize.mjs";
import { summarizeLighthousePayload } from "./summarize.mjs";

export const lighthouseCheck = defineQualityCheck({
  id: "lighthouse",
  async collect(context = {}) {
    return collectLighthouseFromReportDir(context.reportDir, {
      logPath: context.logPath,
    });
  },
  async normalize(raw, context = {}) {
    return normalizeLighthousePayload(raw, {
      selected: context.selected !== false,
      failed: Boolean(context.failed),
    });
  },
  async summarize(normalized) {
    return summarizeLighthousePayload(normalized);
  },
  capabilities: {
    supportsRemote: true,
    supportsLocalBuild: true,
  },
});
