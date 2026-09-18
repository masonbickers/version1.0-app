import assert from 'node:assert/strict';
import { createHealthWebhookHandler } from '../lib/garmin/healthWebhook.js';
const stored=new Map(); let fail=false;
const deps={findUser:async id=>id==='a'?'alice':null,save:async(uid,id,data)=>{if(fail)throw Error('offline');stored.set(`${uid}/${id}`,data);},timestamp:()=>123,logError:()=>{}};
async function send(kind,items){let status;await createHealthWebhookHandler(kind,deps)({body:{[kind]:items}},{status(s){status=s;return this;},json(){}});return status;}
const base={userId:'a',calendarDate:'2026-09-18',summaryId:'one',startTimeInSeconds:1789690000};
assert.equal(await send('hrv',[{...base,lastNightAvg:48}]),200);
assert.equal(stored.get('alice/garmin_hrv_one').data.lastNightAvg,48);
assert.equal(await send('stressDetails',[{...base,averageStressLevel:30},{...base,summaryId:'two',averageStressLevel:40}]),200);
assert.equal(stored.size,3,'Separate stress intervals must not overwrite');
await send('hrv',[{...base,lastNightAvg:49}]);assert.equal(stored.size,3);
assert.equal(await send('hrv',[{...base,userId:'unknown'}]),503);
assert.equal(await send('hrv',[{...base,calendarDate:'2026-02-30'}]),400);
assert.equal(await send('hrv',[{...base,summaryId:'../bad'}]),400);
fail=true;assert.equal(await send('hrv',[base]),503);
console.log('HRV/stress receiver: ownership, interval preservation, replay, dates and retries passed');
