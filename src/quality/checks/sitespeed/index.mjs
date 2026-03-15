import { defineQualityCheck } from "../../core/quality-check.mjs";
import { collectSitespeedFromReportDir } from "./collect.mjs";
import { normalizeSitespeedPayload } from "./normalize.mjs";
import { summarizeSitespeedPayload } from "./summarize.mjs";

export const sitespeedCheck = defineQualityCheck({
  id: "sitespeed",
  async collect(context = {}) {
    return collectSitespeedFromReportDir(context.reportDir, {
      logPath: context.logPath,
    });
  },
  async normalize(raw, context = {}) {
    return normalizeSitespeedPayload(raw, {
      selected: context.selected !== false,
      failed: Boolean(context.failed),
    });
  },
  async summarize(normalized) {
    return summarizeSitespeedPayload(normalized);
  },
  capabilities: {
    supportsRemote: true,
    supportsLocalBuild: true,
  },
});
