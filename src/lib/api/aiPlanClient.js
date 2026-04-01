// app/lib/api/aiPlanClient.js
import { apiPost } from "./client";
import { getJsonAuthHeaders } from "./authHeaders";
import { buildGenerateRunRequest } from "./generateRunAdapter";

export async function generateAiPlan(payload) {
  const request = buildGenerateRunRequest(payload || {});
  if (request.unsupported) {
    throw new Error(request.reason || "Unsupported plan type");
  }
  const query = request.allowDefaults ? "?allowDefaults=1" : "";
  const data = await apiPost(`/generate-run${query}`, {
    athleteProfile: request.athleteProfile,
  }, {
    headers: await getJsonAuthHeaders(),
  });
  return data.plan; // { ...rawPlan }
}
