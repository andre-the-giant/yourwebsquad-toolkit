import { jsonldCheck } from "./jsonld/index.mjs";
import { lighthouseCheck } from "./lighthouse/index.mjs";
import { linksCheck } from "./links/index.mjs";
import { pa11yCheck } from "./pa11y/index.mjs";
import { axeCheck } from "./axe/index.mjs";
import { formCheck } from "./form/index.mjs";
import { securityCheck } from "./security/index.mjs";
import { seoCheck } from "./seo/index.mjs";
import { sitespeedCheck } from "./sitespeed/index.mjs";
import { vnuCheck } from "./vnu/index.mjs";
import {
  clearQualityCheckRegistry,
  getQualityCheck,
  listQualityChecks,
  registerQualityCheck,
} from "../core/registry.mjs";

const DEFAULT_CHECKS = [
  lighthouseCheck,
  pa11yCheck,
  axeCheck,
  formCheck,
  seoCheck,
  linksCheck,
  jsonldCheck,
  securityCheck,
  sitespeedCheck,
  vnuCheck,
];

export function registerDefaultQualityChecks({ reset = false } = {}) {
  if (reset) {
    clearQualityCheckRegistry();
  }

  for (const check of DEFAULT_CHECKS) {
    if (!getQualityCheck(check.id)) {
      registerQualityCheck(check);
    }
  }

  return listQualityChecks();
}
