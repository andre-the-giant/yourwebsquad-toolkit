import { defineQualityCheck } from "../../core/quality-check.mjs";
import { collectJsonldFromReportDir } from "./collect.mjs";
import { normalizeJsonldPayload } from "./normalize.mjs";
import { summarizeJsonldPayload } from "./summarize.mjs";

export const jsonldCheck = defineQualityCheck({
  id: "jsonld",
  async collect(context = {}) {
    return collectJsonldFromReportDir(context.reportDir, {
      logPath: context.logPath,
    });
  },
  async normalize(raw, context = {}) {
    return normalizeJsonldPayload(raw, {
      selected: context.selected !== false,
      failed: Boolean(context.failed),
    });
  },
  async summarize(normalized) {
    return summarizeJsonldPayload(normalized);
  },
  capabilities: {
    supportsRemote: false,
    supportsLocalBuild: true,
  },
});
