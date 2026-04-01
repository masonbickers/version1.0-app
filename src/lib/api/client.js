// app/lib/api/client.js

import { API_URL } from "../../../config/api";

const API_BASE = API_URL;

if (!API_BASE) {
  console.warn(
    "[api/client] EXPO_PUBLIC_API_URL is not set. Set it in your app config (.env or app.json)."
  );
}

async function request(path, options = {}) {
  if (!API_BASE) {
    throw new Error("Missing EXPO_PUBLIC_API_URL for this build.");
  }

  const url = `${API_BASE}${path}`;

  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `[api] ${res.status} ${res.statusText} – ${text || "Request failed"}`
    );
  }

  return res.json();
}

export async function apiPost(path, body, options = {}) {
  return request(path, {
    method: "POST",
    body: JSON.stringify(body || {}),
    ...options,
  });
}
