import assert from 'node:assert/strict';
import { createSleepWebhookHandler } from '../lib/garmin/sleepWebhook.js';
import { selectGarminSleep } from '../../src/lib/journal/garminSleep.mjs';

const stored = new Map();
let fail = false;
const handler = createSleepWebhookHandler({
  findUser: async id => ({ a: 'alice', b: 'bob' })[id] || null,
  save: async (uid, id, data) => { if (fail) throw new Error('offline'); stored.set(`${uid}/${id}`, data); },
  timestamp: () => 123,
  logError: () => {},
});
async function deliver(body) {
  let status; let response;
  await handler({ body }, { status(value) { status = value; return this; }, json(value) { response = value; } });
  return { status, response };
}
const sleep = { userId: 'a', calendarDate: '2026-09-18', durationInSeconds: 28800, awakeDurationInSeconds: 1800, summaryId: 'night-a', startTimeInSeconds: 1789686000 };
assert.equal((await deliver({ sleeps: [sleep, { ...sleep, userId: 'b', durationInSeconds: 28800 }] })).status, 200);
assert.equal(stored.size, 2, 'Mixed users must stay in their own accounts');
const record = stored.get('alice/garmin_sleeps_2026-09-18');
assert.equal(record.kind, 'sleeps');
assert.equal(selectGarminSleep([record], '2026-09-18').hours, 7.5);
assert.equal(selectGarminSleep([record], '2026-09-17'), null);
await deliver({ sleeps: [{ ...sleep, durationInSeconds: 28000 }] });
assert.equal(stored.size, 2, 'Replays update the same night');
assert.equal((await deliver({ sleeps: [{ ...sleep, userId: 'unknown' }] })).status, 503);
assert.equal((await deliver({ sleeps: [{ ...sleep, calendarDate: '../bad' }] })).status, 400);
assert.equal((await deliver({ sleeps: [{ ...sleep, durationInSeconds: null }] })).status, 400);
assert.equal((await deliver({ test: true, sleeps: [sleep] })).status, 200);
fail = true;
assert.equal((await deliver({ sleeps: [sleep] })).status, 503);
assert.equal(selectGarminSleep([{ kind: 'dailies', date: '2026-09-18', data: { durationInSeconds: 86400 } }], '2026-09-18'), null);
console.log('Sleep delivery: ownership, duration, dates, replay, validation and retries passed');
