import { buildRunPlan } from "./generate.js";
import { normalizeIncomingRequest } from "./normalize.js";
import { validateProfile } from "./validate.js";

export function generatePlanFromRequest(body) {
  const { profile, config } = normalizeIncomingRequest(body);
  const { errors, warnings: validationWarnings } = validateProfile(profile);
  if (errors.length) {
    return { ok: false, errors, warnings: validationWarnings, plan: null };
  }

  const plan = buildRunPlan(profile, config);
  const generatorWarnings = Array.isArray(plan?.decisionTrace?.warnings) ? plan.decisionTrace.warnings : [];
  const warnings = [...new Set([...validationWarnings, ...generatorWarnings])];
  return { ok: true, errors: [], warnings, plan };
}
