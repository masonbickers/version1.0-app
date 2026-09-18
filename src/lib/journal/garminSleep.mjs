// Only explicit sleep totals and calendar dates are accepted. Fetch timestamps
// and generic duration fields cannot identify the night or its sleep duration.
export function selectGarminSleep(records, dateKey) {
  const candidates = [];
  for (const record of records) {
    const payload = record.data || record.payload || record.summary || record;
    const source = payload.summary || payload.dailySummary || payload.wellnessSummary || payload;
    const day = source.calendarDate || source.dateKey || record.calendarDate || record.dateKey || record.date;
    if (day !== dateKey || source.error || source.errorMessage || source.errors) continue;
    const fields = [
      [source.sleepingSeconds, 1], [source.sleepDurationMinutes, 60],
      [source.totalSleepMinutes, 60], [source.sleepHours, 3600],
    ];
    let seconds = null;
    for (const [value, multiplier] of fields) {
      if (value == null || value === '' || typeof value === 'boolean') continue;
      const number = Number(value);
      if (Number.isFinite(number) && number > 0 && number * multiplier <= 86400) {
        seconds = number * multiplier;
        break;
      }
    }
    if (seconds == null) continue;
    const stamp = record.updatedAt || record.fetchedAt || record.fetchedAtMs;
    const updated = stamp?.toMillis?.() ?? (stamp?.seconds ? stamp.seconds * 1000 : Number(stamp) || 0);
    candidates.push({ source: 'garmin', dateKey, recordId: record.id, seconds, hours: seconds / 3600, updated });
  }
  return candidates.sort((a, b) => b.updated - a.updated)[0] || null;
}

export function sleepFromGarmin(existing, imported, dateKey) {
  if (imported?.dateKey === dateKey) return imported;
  const saved = existing?.sleepData;
  return saved?.source === 'garmin' && saved.dateKey === dateKey && Number.isFinite(saved.hours) && saved.hours > 0 && saved.hours <= 24 ? saved : null;
}
