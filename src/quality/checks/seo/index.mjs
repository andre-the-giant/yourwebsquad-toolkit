import { defineQualityCheck } from "../../core/quality-check.mjs";
import { collectSeoFromReportDir } from "./collect.mjs";
import { normalizeSeoPayload } from "./normalize.mjs";
import { summarizeSeoPayload } from "./summarize.mjs";

export const seoCheck = defineQualityCheck({
  id: "seo",
  async collect(context = {}) {
    return collectSeoFromReportDir(context.reportDir, {
      logPath: context.logPath,
    });
  },
  async normalize(raw, context = {}) {
    return normalizeSeoPayload(raw, {
      selected: context.selected !== false,
      failed: Boolean(context.failed),
    });
  },
  async summarize(normalized) {
    return summarizeSeoPayload(normalized);
  },
  capabilities: {
    supportsRemote: true,
    supportsLocalBuild: true,
  },
});

