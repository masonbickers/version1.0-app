# Run Planner Dynamic Spec (v1)

This document locks the planner contract for:
- distance
- plan length (weeks)
- sessions per week
- athlete level (experience + difficulty)

It is intentionally implementation-linked to current code in:
- `server/lib/train/planRules/rulesConfig.js`
- `server/lib/train/planRules/normalization.js`
- `server/lib/train/planRules/planSpecs/*`
- `server/lib/train/planRules/skeleton.js`
- `server/lib/train/planRules/progression.js`
- `server/lib/train/planRules/fillSessions.js`

## 1) Canonical Supported Goal Distances

Primary supported goals:
- `5K`
- `10K`
- `HALF` (Half Marathon)
- `MARATHON`
- `ULTRA`

Accepted aliases (normalized to the above):
- `5K`: `5KM`, `PARKRUN`, `5`, `5 km`
- `10K`: `10KM`, `10`, `10 km`
- `HALF`: `HALF MARATHON`, `HALF-MARATHON`, `HM`, `21K`, `21.1K`, `21.0975K`
- `MARATHON`: `MARA`, `42K`, `42.2K`, `42.195K`, `26.2`
- `ULTRA`: `50K`, `50M`, `100K`

Fallback behavior:
- Unknown/unsupported distance falls back to `10K` plan spec.

## 2) Canonical Plan Length Rules

Canonical bounds:
- `minWeeks = 1`
- `maxWeeks = 52`
- `defaultWeeks = 12`

Normalization:
- Any non-numeric or missing value uses default.
- Any value outside bounds is clamped to bounds.

Source:
- `RULES.normalization.planLengthWeeks`
- `normalisePlanLengthWeeks(...)`

## 3) Canonical Session Frequency Rules

Canonical bounds:
- `minSessionsPerWeek = 1`
- `maxSessionsPerWeek = 7`
- `defaultSessionsPerWeek = 4`

Run day behavior:
- Run days are normalized to `Mon..Sun`.
- Duplicates are removed.
- If not enough run days are provided, defaults are injected by session count.
- If too many run days are provided, list is trimmed to match session count.

Default run-day templates:
- 1: `Sun`
- 2: `Tue, Sun`
- 3: `Tue, Thu, Sun`
- 4: `Tue, Thu, Sat, Sun`
- 5: `Mon, Tue, Thu, Sat, Sun`
- 6: `Mon, Tue, Wed, Thu, Sat, Sun`
- 7: `Mon, Tue, Wed, Thu, Fri, Sat, Sun`

Long run day:
- Default: `Sun`
- If requested long-run day is not in final run-day set, planner picks `Sun` when possible, otherwise last run day.

Source:
- `RULES.normalization.sessionsPerWeek`
- `RULES.normalization.fallbackRunDaysBySessions`
- `RULES.normalization.defaultLongRunDay`

## 4) Athlete Level Model

### 4.1 Experience Levels (product-facing)
Canonical values:
- `New to running`
- `Some experience`
- `Regular runner`
- `Advanced/competitive`

Current max hard sessions by experience:
- New to running: `1`
- Some experience: `1`
- Regular runner: `2`
- Advanced/competitive: `2`

Source:
- `RULES.productSpec.experienceLevels`
- `RULES.maxHardSessionsByExperience`

### 4.2 Difficulty Modes (product-facing)
Canonical values:
- `easy`
- `balanced`
- `hard`

Public difficulty normalizes into progression difficulty:
- `easy` -> `conservative`
- `balanced` -> `standard`
- `hard` -> `aggressive`
- `elite` is internal progression-only and not a primary public mode.

Source:
- `RULES.productSpec.difficultyModes`
- `normalisePublicDifficulty(...)`
- `normaliseProgressionDifficulty(...)`

## 5) Dynamic Behavior Definition

This section defines what "dynamic" means in this planner.

### 5.1 Dynamic by Distance
- Distance selects a specific plan spec (`planSpecs/*`) with:
  - phase template
  - long-run policy (`minOfCurrentLongest`, `targetWeeklyFraction`, `maxKm`, deload/taper multipliers)
  - workout menus by phase (interval + tempo)
- Distance influences:
  - long-run max caps
  - taper length defaults
  - quality-share shifts
  - threshold preference behavior

### 5.2 Dynamic by Plan Length (Weeks)
- Phase assignment rules:
  - If spec phase list length equals requested weeks: use directly.
  - If spec phase list is longer than requested weeks: compress across timeline.
  - If requested weeks exceed spec phase list: use dynamic fallback (base/build/specific + deload + taper logic).
- Deload:
  - default cadence every 4th week.
- Taper:
  - distance-aware taper length from `byDistance` then global default.
- Weekly progression:
  - capped growth per build week (`+10%` or `+6km`, whichever smaller by current config).

### 5.3 Dynamic by Sessions Per Week
- Session count controls:
  - number of run days
  - day-intent allocation (quality/easy/long)
  - hard-day spacing constraints
  - quality-session limits (especially at low frequency)
- Single-run-week behavior:
  - if sessions/week is `1`, long run carries whole weekly target.

### 5.4 Dynamic by Level (Experience + Difficulty)
- Experience sets baseline hard-session allowance.
- Difficulty modifies:
  - hard-day target
  - weekly cap multipliers
  - long-run quality insertion behavior
  - quality km bounds and quality-share shifts
  - progression intensity profile across the cycle

## 6) Core Input Contract (Current)

### Required for high-quality dynamic planning
- `athleteProfile.goal.distance`
- `athleteProfile.goal.planLengthWeeks`
- `athleteProfile.current.weeklyKm`
- `athleteProfile.current.longestRunKm`
- `athleteProfile.current.experience`
- `athleteProfile.availability.sessionsPerWeek`
- `athleteProfile.availability.runDays`
- `athleteProfile.availability.longRunDay`
- `athleteProfile.preferences.difficulty`

### Optional, currently supported
- `athleteProfile.goal.targetDate` / `eventDate`
- `athleteProfile.current.recentTimes` (`fiveK`, `tenK`, `half`, `marathon`)
- `athleteProfile.pacing.thresholdPaceSecPerKm`
- `athleteProfile.pacing.recentRace` (`distanceKm`, `timeSec`)
- `athleteProfile.hr.max` + `athleteProfile.hr.resting`
- `athleteProfile.hr.resting` + `athleteProfile.current.age` (`220-age` max HR)
- `athleteProfile.hr.lthr`
- `athleteProfile.preferences.metric`
- `athleteProfile.preferences.treadmill`
- `athleteProfile.preferences.timePerSessionMin`
- `athleteProfile.preferences.longRunMaxMin`

## 7) Output/Invariant Contract

The planner returns:
- canonical sessions in `weeks[].sessions`
- derived day views in `weeks[].days[].sessions`
- synchronized ids and references (`sessionId`, `sessionIds`)
- distance contract fields for budgeted vs rendered metrics

Minimum invariants:
- session count matches frequency/run days
- canonical and derived session views stay in sync
- weekly and per-session distance fields remain internally consistent
- guardrail edits are tracked in week metrics notes

## 8) Definition of Done for Item 1

Item 1 is complete when:
- this document is the agreed planner contract
- canonical limits are centralized in config (distance set, weeks, sessions/week, level modes)
- normalization uses shared config-derived bounds
- no separate hardcoded week/session bounds conflict with this spec

Current status:
- Weeks/session bounds are centralized and normalized.
- Distance, experience, and difficulty canonical sets are declared in `RULES.productSpec`.
- Remaining items (strict API enforcement and deeper dynamic tuning) are next phases.
