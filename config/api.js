// config/api.js
import Constants from "expo-constants";
import { Platform } from "react-native";

function normalizeApiUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;

  try {
    const url = new URL(withScheme);
    return `${url.protocol}//${url.host}`.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function hostFromApiUrl(value) {
  try {
    return new URL(String(value || "")).hostname || "";
  } catch {
    return "";
  }
}

function isPrivateHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host === "0.0.0.0") return true;
  if (host === "127.0.0.1" || host.startsWith("127.")) return true;
  if (host.startsWith("10.")) return true;
  if (host.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  return false;
}

function resolveDevHost() {
  const candidates = [
    Constants?.expoGoConfig?.debuggerHost,
    Constants?.expoConfig?.hostUri,
    Constants?.manifest2?.extra?.expoClient?.hostUri,
    Constants?.manifest?.debuggerHost,
  ];

  for (const c of candidates) {
    const host = String(c || "").split(":")[0];
    if (host) return host;
  }

  return "localhost";
}

function resolveApiUrl() {
  const envDev = normalizeApiUrl(process.env.EXPO_PUBLIC_DEV_API_URL);
  if (__DEV__ && envDev) {
    return envDev;
  }

  const envPrimary = normalizeApiUrl(process.env.EXPO_PUBLIC_API_URL);
  if (envPrimary) {
    const host = hostFromApiUrl(envPrimary);
    if (!__DEV__ && isPrivateHost(host)) return "";
    return envPrimary;
  }

  const envLegacy = normalizeApiUrl(process.env.EXPO_PUBLIC_API_BASE);
  if (envLegacy) {
    const host = hostFromApiUrl(envLegacy);
    if (!__DEV__ && isPrivateHost(host)) return "";
    return envLegacy;
  }

  if (!__DEV__) return "";

  const host = resolveDevHost();
  if (Platform.OS === "android" && host === "localhost") {
    return "http://10.0.2.2:3001";
  }
  return `http://${host}:3001`;
}

export const API_URL = resolveApiUrl();
export const HAS_API_URL = Boolean(API_URL);

export function requireApiUrl() {
  if (!API_URL) {
    throw new Error("Missing EXPO_PUBLIC_API_URL for this build.");
  }
  return API_URL;
}
