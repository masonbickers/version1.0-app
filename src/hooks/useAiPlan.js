// src/hooks/useAiPlan.js
import { useCallback, useState } from "react";
import { API_URL } from "../../config/api"; // 👈 adjust path if needed
import { getJsonAuthHeaders } from "../lib/api/authHeaders";
import { buildGenerateRunRequest } from "../lib/api/generateRunAdapter";

export function useAiPlan() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const createPlan = useCallback(async (payload) => {
    setLoading(true);
    setError(null);

    try {
      if (!API_URL) {
        throw new Error("EXPO_PUBLIC_API_URL is not configured.");
      }
      const request = buildGenerateRunRequest(payload || {});
      if (request.unsupported) {
        throw new Error(request.reason || "Unsupported plan type");
      }

      const query = request.allowDefaults ? "?allowDefaults=1" : "";
      const url = `${API_URL}/generate-run${query}`;
      console.log("[useAiPlan] POST ->", url);

      const res = await fetch(url, {
        method: "POST",
        headers: await getJsonAuthHeaders(),
        body: JSON.stringify({ athleteProfile: request.athleteProfile }),
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        // if server returns plain text on error
        throw new Error(text || `HTTP ${res.status}`);
      }

      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      // server returns { plan, source }
      const plan = data.plan || data;

      if (!plan || !Array.isArray(plan.weeks)) {
        throw new Error("Plan response missing weeks");
      }

      return plan;
    } catch (e) {
      console.log("[useAiPlan] error:", e);
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { createPlan, loading, error, API_URL };
}
