// app/hooks/useAiPlanV2.js
import { useCallback, useState } from "react";
import { API_URL } from "../../config/api";
import { getJsonAuthHeaders } from "../../src/lib/api/authHeaders";
import { buildGenerateRunRequest } from "../../src/lib/api/generateRunAdapter";

export function useAiPlanV2() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const createPlan = useCallback(async (payload) => {
    setLoading(true);
    setError(null);

    try {
      if (!API_URL) {
        throw new Error("EXPO_PUBLIC_API_URL is not defined.");
      }
      const request = buildGenerateRunRequest(payload || {});
      if (request.unsupported) {
        throw new Error(request.reason || "Unsupported plan type");
      }
      const query = request.allowDefaults ? "?allowDefaults=1" : "";
      const url = `${API_URL}/generate-run${query}`;
      console.log("[useAiPlanV2] POST ->", url);
      console.log("[useAiPlanV2] payload ->", payload);

      const res = await fetch(url, {
        method: "POST",
        headers: await getJsonAuthHeaders(),
        body: JSON.stringify({ athleteProfile: request.athleteProfile }),
      });

      const text = await res.text();
      console.log("[useAiPlanV2] raw response ->", text);

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text || `HTTP ${res.status}`);
      }

      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      const plan = data.plan || data;
      if (!plan || !Array.isArray(plan.weeks)) throw new Error("Plan response missing weeks");

      return plan;
    } catch (e) {
      console.log("[useAiPlanV2] error:", e);
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { createPlan, loading, error };
}

// Avoid expo-router warning when this utility is located under /app.
export default function HooksUseAiPlanV2Route() {
  return null;
}
