// Each stress interval has its own summary ID; retries overwrite only that interval.
export function createHealthWebhookHandler(kind, { findUser, save, timestamp, logError = console.error }) {
  if (!['hrv', 'stressDetails'].includes(kind)) throw new Error('Unsupported health summary');
  return async (req, res) => {
    const payload = req.body?.payload || req.body?.body || req.body || {};
    if (payload.test === true || payload.type === 'test') return res.status(200).json({ ok: true, test: true });
    const items = payload[kind];
    if (!Array.isArray(items)) return res.status(400).json({ error: 'invalid_health_payload' });
    for (const item of items) {
      const date = item?.calendarDate;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') ||
          !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
          new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
          typeof item.userId !== 'string' || !item.userId ||
          typeof item.summaryId !== 'string' || !/^[a-zA-Z0-9_-]{1,300}$/.test(item.summaryId)) {
        return res.status(400).json({ error: 'invalid_health_summary' });
      }
    }
    try {
      const users = new Map();
      for (const item of items) {
        if (!users.has(item.userId)) users.set(item.userId, await findUser(item.userId));
        if (!users.get(item.userId)) return res.status(503).json({ error: 'health_user_not_linked' });
      }
      for (const item of items) {
        await save(users.get(item.userId), `garmin_${kind}_${item.summaryId}`, {
          kind, date: item.calendarDate, garminUserId: item.userId,
          updatedAt: timestamp(), data: item,
        });
      }
      return res.status(200).json({ ok: true, saved: items.length });
    } catch (error) {
      logError('[garmin-webhook] health delivery failed', error);
      return res.status(503).json({ error: 'health_delivery_failed' });
    }
  };
}
