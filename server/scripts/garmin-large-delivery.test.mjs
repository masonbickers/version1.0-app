import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripUndefinedDeep } from '../utils/firestoreSafe.js';

const source = readFileSync(process.env.GARMIN_WEBHOOK_TEST_SOURCE || new URL('../routes/garmin-webhook.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\n/gm, '')
  .replace(/export default router;?/, '');
const routes = new Map();
const saved = [];
const errors = [];
let failWrites = false;
const firestore = () => ({
  collection(name) {
    return {
      async add(data) {
        if (failWrites) throw new Error("storage unavailable");
        if (Buffer.byteLength(JSON.stringify(data)) > 1_000_000) throw new Error('Document exceeds Firestore size limit');
        if (name === 'garmin_errors') errors.push(data);
        return { id: 'raw', async update() {} };
      },
      where() { return { limit() { return { async get() { return { empty: false, docs: [{ id: 'test-user' }] }; } }; } }; },
      doc(id) { return { collection() { return { doc(date) { return { id, date }; } }; } }; },
    };
  },
  batch() { return { set(ref, data) { saved.push({ ref, data }); }, async commit() {} }; },
});
firestore.FieldValue = { serverTimestamp: () => 123 };
vm.runInNewContext(source, {
  express: { Router: () => ({ post: (path, handler) => routes.set(path, handler) }) },
  admin: { firestore }, stripUndefinedDeep, console: { log() {}, warn() {}, error() {} },
  process: { env: {} }, Buffer,
});
const dailies = Array.from({ length: 30 }, (_, i) => ({
  userId: 'garmin-test-user', calendarDate: `2026-09-${String(i + 1).padStart(2, '0')}`,
  steps: 1000 + i, timeOffsetHeartRateSamples: Object.fromEntries(Array.from({ length: 4000 }, (_, j) => [String(j * 15), 60])),
}));
assert.ok(Buffer.byteLength(JSON.stringify({ dailies })) > 1_048_576);
let status;
await routes.get('/dailies')({ body: { dailies }, path: '/dailies', protocol: 'https', get: () => 'test.invalid', headers: {}, originalUrl: '/webhooks/garmin/dailies' }, {
  status(value) { status = value; return this; }, json() {},
});
assert.equal(errors.length, 0, JSON.stringify(errors));
assert.equal(saved.length, 30, 'Every daily summary should survive a large history delivery');
assert.equal(saved[29].data.data.steps, 1029);
assert.equal(status, 200);
console.log('Large Garmin delivery preserves all 30 daily summaries');

failWrites = true;
await routes.get('/dailies')({ body: { dailies: [] }, path: '/dailies', protocol: 'https', get: () => 'test.invalid', headers: {} }, {
  status(value) { status = value; return this; }, json() {},
});
assert.equal(status, 503, 'Failed storage must tell Garmin to retry');
console.log('Failed storage remains retryable');
