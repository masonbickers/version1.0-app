import { buildSkeleton } from './server/lib/train/planRules/skeleton.js';
import { buildProgressionTargets } from './server/lib/train/planRules/progression.js';
import { fillSessionsFromSkeleton } from './server/lib/train/planRules/fillSessions.js';
import { validateAndRepairPlan } from './server/lib/train/planRules/validateAndRepair.js';

const weeks = 8;

const profile = {
  sessionsPerWeek: 4,
  longRunDay: 'Sun',
  experience: 'Some experience',
  goal: { distance: '10K', primaryFocus: 'PB / time goal', targetTime: '00:37:00' },
};

const skeleton = buildSkeleton({ weeks, sessionsPerWeek: 4, longRunDay: 'Sun', experience: 'Some experience' });
const targets = buildProgressionTargets({ weeks, weeklyKmStart: 30, longestRunKmStart: 25 });

let plan = fillSessionsFromSkeleton({ skeleton, targets, profile });
plan = validateAndRepairPlan(plan, skeleton, { weeks: targets }, profile.experience);

const hardTypes = new Set(['QUALITY','INTERVALS','TEMPO','HILLS','RACEPACE']);

const rows = plan.weeks.map(w => {
  const total = w.sessions.reduce((s,x)=>s+(Number(x.distanceKm)||0),0);
  const long = w.sessions.find(s => String(s.type||'').toUpperCase()==='LONG')?.distanceKm ?? 0;
  const hardCount = w.sessions.filter(s => hardTypes.has(String(s.type||'').toUpperCase())).length;

  return {
    week: w.weekIndex,
    targetWeekly: w.targets?.weeklyKm,
    actualWeekly: Math.round(total*10)/10,
    targetLong: w.targets?.longRunKm,
    actualLong: Math.round(Number(long||0)*10)/10,
    longPct: total>0 ? Math.round((long/total)*100) + '%' : '0%',
    hardSessions: hardCount,
    isDeload: !!w.targets?.isDeload,
  };
});

console.table(rows);
