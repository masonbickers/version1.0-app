import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { generatePlanFromRequest } from "../src/planner/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const payloadPath = path.join(__dirname, "..", "examples", "request.json");
const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));

const result = generatePlanFromRequest(payload);
assert.equal(result.ok, true, `expected valid payload: ${(result.errors || []).join("; ")}`);
assert.equal(result.plan.weeks.length, 10, "expected 10 weeks");
assert.equal(result.plan.weeks[0].sessions.length, 4, "expected 4 sessions in week 1");

const lastWeek = result.plan.weeks[result.plan.weeks.length - 1];
assert.ok(lastWeek.sessions.some((s) => s.type === "RACE"), "expected race session in last week");

console.log(
  JSON.stringify(
    {
      ok: true,
      name: result.plan.name,
      weeks: result.plan.weeks.length,
      week1: result.plan.weeks[0].metrics,
      lastWeek: lastWeek.metrics
    },
    null,
    2
  )
);
