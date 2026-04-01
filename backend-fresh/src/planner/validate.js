import { ALLOWED_GOAL_DISTANCES } from "./defaults.js";

export function validateProfile(profile) {
  const errors = [];
  const warnings = [];

  if (!profile.goal.distance) {
    errors.push(
      `athleteProfile.goal.distance is required. Supported: ${ALLOWED_GOAL_DISTANCES.join(", ")}.`
    );
  }
  if (!Number.isInteger(profile.goal.planLengthWeeks) || profile.goal.planLengthWeeks < 2) {
    errors.push("athleteProfile.goal.planLengthWeeks is required and must be an integer >= 2.");
  }

  if (!Number.isFinite(profile.current.weeklyKm) || profile.current.weeklyKm <= 0) {
    errors.push("athleteProfile.current.weeklyKm is required and must be > 0.");
  }
  if (!Number.isFinite(profile.current.longestRunKm) || profile.current.longestRunKm <= 0) {
    errors.push("athleteProfile.current.longestRunKm is required and must be > 0.");
  }

  const sessions = profile.availability.sessionsPerWeek;
  if (!Number.isInteger(sessions) || sessions < 2 || sessions > 7) {
    errors.push("athleteProfile.availability.sessionsPerWeek is required and must be 2-7.");
  }

  if (!Array.isArray(profile.availability.runDays) || !profile.availability.runDays.length) {
    errors.push("athleteProfile.availability.runDays must include at least one day.");
  }

  if (Number.isInteger(sessions) && profile.availability.runDays.length !== sessions) {
    errors.push("availability.runDays count must match availability.sessionsPerWeek.");
  }

  if (!profile.availability.longRunDay) {
    errors.push("athleteProfile.availability.longRunDay is required.");
  } else if (!profile.availability.runDays.includes(profile.availability.longRunDay)) {
    errors.push("availability.longRunDay must be one of availability.runDays.");
  }

  if (!profile.goal.targetDate) {
    warnings.push("No goal.targetDate provided; output will be week-indexed without calendar dates.");
  }

  if (profile?.goal?.anchorDateMode === "start" && !profile?.goal?.startDate) {
    warnings.push(
      "goal.anchorDateMode is 'start' but no goal.startDate was provided; calendar anchoring will fall back to race date."
    );
  }

  const templateWeeks = Number(profile?.templateMeta?.weeks);
  if (
    profile.goal.targetDate &&
    Number.isInteger(templateWeeks) &&
    templateWeeks >= 2 &&
    Number.isInteger(profile.goal.planLengthWeeks) &&
    profile.goal.planLengthWeeks > templateWeeks
  ) {
    warnings.push(
      `Requested ${profile.goal.planLengthWeeks} weeks with a ${templateWeeks}-week stock template; bridge weeks will be added before core plan start.`
    );
  }

  if (!Number.isFinite(profile.pacing.thresholdPaceSecPerKm) && !Number.isFinite(profile.pacing.recentRace.timeSec)) {
    warnings.push("No pace anchor detected; using fallback pace defaults.");
  }

  if (!Number.isFinite(profile.hr.max) && !Number.isFinite(profile.current.age)) {
    warnings.push("No HR max or age provided; HR zones will be omitted.");
  }

  return { errors, warnings };
}
