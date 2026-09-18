// Keep sleep deliveries separate from daily/activity durations. Dependencies are
// injected so delivery behaviour can be tested without real accounts or tokens.
export function createSleepWebhookHandler({ findUser, save, timestamp, logError = console.error }) {
  return async (req, res) => {
    const payload = req.body?.payload || req.body?.body || req.body || {};
    const items = payload.sleeps;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'invalid_sleep_payload' });
    if (payload.test === true || payload.type === 'test') return res.status(200).json({ ok: true, test: true });
    const records = [];
    for (const item of items) {
      const date = item?.calendarDate;
      const duration = item?.durationInSeconds;
      // Garmin sleep duration is time asleep; awake time is a separate total.
      const seconds = duration;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') ||
          !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
          new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
          typeof duration !== 'number' ||
          !Number.isFinite(seconds) || seconds <= 0 || duration > 86400 ||
          typeof item.userId !== 'string' || !item.userId) {
        return res.status(400).json({ error: 'invalid_sleep_summary' });
      }
      records.push({ item, date, seconds });
    }
    try {
      const users = new Map();
      // Resolve all owners before writing. Unknown mappings remain retryable.
      for (const { item } of records) {
        if (!users.has(item.userId)) users.set(item.userId, await findUser(item.userId));
        if (!users.get(item.userId)) return res.status(503).json({ error: 'sleep_user_not_linked' });
      }
      for (const { item, date, seconds } of records) {
        await save(users.get(item.userId), `garmin_sleeps_${date}`, {
          kind: 'sleeps', date, garminUserId: item.userId, updatedAt: timestamp(),
          data: { ...item, sleepingSeconds: seconds },
        });
      }
      return res.status(200).json({ ok: true, saved: records.length });
    } catch (error) {
      logError('[garmin-webhook] sleep delivery failed', error);
      return res.status(503).json({ error: 'sleep_delivery_failed' });
    }
  };
}
