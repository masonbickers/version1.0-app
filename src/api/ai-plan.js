// app/api/ai-plan.js
import { API_URL } from "../../config/api";
import { getJsonAuthHeaders } from "../lib/api/authHeaders";
import { buildGenerateRunRequest } from "../lib/api/generateRunAdapter";

/* ---------------------------------------------
   Call the backend AI endpoint
---------------------------------------------- */
export async function generateAIPlan(payload) {
  if (!API_URL) {
    throw new Error("EXPO_PUBLIC_API_URL is not defined.");
  }

  const request = buildGenerateRunRequest(payload || {});
  if (request.unsupported) {
    throw new Error(request.reason || "Unsupported plan type");
  }
  const query = request.allowDefaults ? "?allowDefaults=1" : "";

  const res = await fetch(`${API_URL}/generate-run${query}`, {
    method: "POST",
    headers: await getJsonAuthHeaders(),
    body: JSON.stringify({ athleteProfile: request.athleteProfile }),
  });

  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${text}`);
  }

  if (!res.ok) {
    throw new Error(data?.error || "AI plan generation failed.");
  }

  return data;
}
