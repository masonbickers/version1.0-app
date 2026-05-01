export const LIVE_ACTIVITY_STALE_MS = 8 * 60 * 60 * 1000;

export const ACTIVE_LIVE_ACTIVITY_STATUSES = new Set([
  "acquiring",
  "running",
  "paused",
]);

export function normaliseLiveActivityStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "live") return "running";
  if (value === "running" || value === "paused" || value === "acquiring") return value;
  return "idle";
}

export function getLiveActivityUpdatedAt(activity) {
  const updatedAt = Number(activity?.updatedAt || 0);
  return Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0;
}

export function isLiveActivityStale(
  activity,
  now = Date.now(),
  staleMs = LIVE_ACTIVITY_STALE_MS
) {
  const updatedAt = getLiveActivityUpdatedAt(activity);
  if (updatedAt <= 0) return true;
  return now - updatedAt > staleMs;
}

export function shouldPauseStaleLiveActivity(
  activity,
  now = Date.now(),
  staleMs = LIVE_ACTIVITY_STALE_MS
) {
  if (!activity?.isActive) return false;
  const status = normaliseLiveActivityStatus(activity?.status);
  if (status !== "running" && status !== "acquiring") return false;
  return isLiveActivityStale(activity, now, staleMs);
}

export function hasLiveActivitySnapshot(activity) {
  return (
    !!activity?.snapshot &&
    typeof activity.snapshot === "object" &&
    !Array.isArray(activity.snapshot)
  );
}
