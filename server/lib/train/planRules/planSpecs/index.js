// server/lib/train/planRules/planSpecs/index.js
import spec10k from "./10k.js";
import spec5k from "./5k.js";
import specHalf from "./half.js";
import specMarathon from "./marathon.js";
import specUltra from "./ultra.js";
import { normaliseGoalDistanceKey } from "../normalization.js";

const MAP = {
  "5K": spec5k,
  "10K": spec10k,
  HALF: specHalf,
  MARATHON: specMarathon,
  ULTRA: specUltra,
};

function withFallbackSpec(spec) {
  // minimal safe defaults so downstream never explodes
  const base = spec && typeof spec === "object" ? spec : {};
  return {
    id: base.id || "DEFAULT_10K",
    name: base.name || "10K",
    longRun: base.longRun || {
      // used by progression.js if present
      minOfCurrentLongest: 0.8,
      targetWeeklyFraction: 0.35,
      maxKm: null,
      deloadMult: 0.85,
      taperMult: 0.85,
    },
    phases: Array.isArray(base.phases) ? base.phases : null,
    ...base,
  };
}

export function getPlanSpec(goalDistance) {
  const key = normaliseGoalDistanceKey(goalDistance, { fallback: "10K" });
  const picked = MAP[key] || spec10k;
  return withFallbackSpec(picked);
}
