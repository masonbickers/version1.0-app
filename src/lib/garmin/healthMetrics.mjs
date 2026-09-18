function number(...values) {
  return values.find(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) ?? null;
}
function minutes(value) { const n = number(value); return n == null ? null : n / 60; }
export function summariseHealthDoc(doc) {
  const kind = String(doc?.kind || doc?.id || '').toLowerCase();
  if (/request|pull/.test(kind) || kind === 'user_id') return { hasUsefulData: false };
  const payload = doc?.data || doc?.payload || doc?.summary || doc || {};
  const s = payload.summary || payload.dailySummary || payload.wellnessSummary || payload;
  if (s.errorMessage || s.error || s.errors || s.status >= 400) return { hasUsefulData: false };
  const active = number(s.activeKilocalories, s.activeCalories);
  const resting = number(s.bmrKilocalories);
  const moderate = minutes(s.moderateIntensityDurationInSeconds);
  const vigorous = minutes(s.vigorousIntensityDurationInSeconds);
  const batterySamples = Object.entries(s.timeOffsetBodyBatteryValues || {})
    .filter(([offset, value]) => Number.isFinite(Number(offset)) && number(value) != null && value <= 100)
    .sort((a, b) => Number(b[0]) - Number(a[0]));
  const stress = number(s.averageStressLevel, s.avgStressLevel);
  const summary = {
    steps: number(s.steps, s.totalSteps, s.stepCount),
    activeCalories: active, restingCalories: resting,
    totalCalories: active != null && resting != null ? active + resting : null,
    stress: stress != null && stress <= 100 ? stress : null,
    bodyBattery: number(batterySamples[0]?.[1], s.bodyBatteryMostRecentValue, s.bodyBattery),
    charged: number(s.bodyBatteryChargedValue), drained: number(s.bodyBatteryDrainedValue),
    sleep: number(s.sleepDurationMinutes, s.totalSleepMinutes, minutes(s.sleepingSeconds)),
    sleepScore: number(s.overallSleepScore?.value),
    deep: minutes(s.deepSleepDurationInSeconds), light: minutes(s.lightSleepDurationInSeconds),
    rem: minutes(s.remSleepInSeconds), awake: minutes(s.awakeDurationInSeconds),
    hrv: number(s.lastNightAvg, s.hrvMs, s.hrv),
    restingHr: number(s.restingHeartRateInBeatsPerMinute, s.restingHeartRate, s.restingHr, s.rhr),
    moderate, vigorous,
    intensityMinutes: moderate != null && vigorous != null ? moderate + 2 * vigorous : null,
  };
  return { ...summary, hasUsefulData: Object.values(summary).some(value => value != null) };
}
