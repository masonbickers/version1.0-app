# Be App

Expo React Native app for training, nutrition, coaching, Garmin/Strava integrations, and rules-based run-plan generation.

## Project Shape

- `app/` - Expo Router screens. Auth routes live in `app/(auth)`, signed-in app routes in `app/(protected)`.
- `components/` - shared React Native UI.
- `providers/` - app-wide auth, theme, and live activity providers.
- `config/api.js` - frontend API base URL resolution.
- `src/` - shared frontend hooks, API clients, and training utilities.
- `server/` - canonical Express API, default port `3001`. The production run-plan route is `POST /generate-run`.
- `backend-fresh/` - older standalone planner service, default port `3101`. Keep it as a reference sandbox; do not wire new product flows to it unless the app explicitly migrates.

## Requirements

- Node.js `>=18`
- npm
- Expo CLI via `npx expo`
- Firebase client project is configured in `firebaseConfig.js`

For the main API, set these as needed:

- `FIREBASE_SERVICE_ACCOUNT_PATH` or `FIREBASE_SERVICE_ACCOUNT_JSON` for Firebase Admin backed routes.
- `OPENAI_API_KEY` for AI-backed routes.
- `EXPO_PUBLIC_API_URL` for production/mobile builds.
- `EXPO_PUBLIC_DEV_API_URL` for local Expo builds when the API is not on the default detected host.
- Garmin, Strava, USDA, and Nutritionix env vars for their respective integrations.

Without Firebase Admin credentials, the API starts in local-safe mode so `/health` and non-Firebase checks can run. Firebase-backed requests will fail at request time until credentials are configured.

Copy the examples before local development:

```bash
cp .env.example .env
cp server/.env.example server/.env
```

## Run

Install root dependencies:

```bash
npm install
```

Start the mobile app:

```bash
npm start
```

Run iOS, Android, or web:

```bash
npm run ios
npm run android
npm run web
```

Start the main API:

```bash
cd server
npm install
npm run dev
```

Start the secondary planner service:

```bash
cd backend-fresh
npm install
npm run dev
```

## Test And QA

Lint:

```bash
npm run lint
```

Plan generator checks:

```bash
npm run plan:sample
npm run plan:stock-template-regression
npm run plan:20-scenarios
npm run plan:create-run-page-e2e
npm run plan:real-scenarios
npm run plan:invariants
npm run plan:quality
npm run plan:distance-propagation-regression
npm run plan:personalization-regression
npm run plan:e2e
```

`plan:e2e` covers the generator API contract: health, auth rejection, happy-path generation, missing-field rejection, low-frequency goal blocking, explicit risk override, and malformed personalization anchors.

`plan:create-run-page-e2e` covers the Create Run Plan page contract: targetable mobile fields, user-entered longest-run propagation, happy-path generation, and low-frequency risk override wiring.

`plan:real-scenarios` covers named user-like plans: new runner 5K, comeback 10K, fast 5K, some-experience 10K, first marathon, regular half marathon, advanced marathon, ultra runner, return-to-running, low-availability blockers, and missing pace/HR anchors.

## Plan Generator Guardrails

The canonical route is:

```text
POST /generate-run
```

Deprecated plan routes return `410`.

Unsafe goal/frequency combinations are blocked by default:

- Half marathon with 1 run/week.
- Marathon with fewer than 3 runs/week.
- Ultra with fewer than 4 runs/week.

Use `?allowGoalRisk=1` only for review-only generation when the athlete accepts the limitation. The generated plan still includes a `professionalReview` and should show `not_approved` when coaching guardrails fail.

The Create Run Plan page sends:

- goal distance, target date or plan length, and target time when enabled
- experience level, age, gender metadata, current weekly km, and longest recent run
- run frequency, selected run days, long-run day, and difficulty
- pace anchors from threshold pace, recent 5K/10K times, or goal-time-derived race pace

The generator starts from stock templates, then adapts volume, long-run progression, quality density, race/taper structure, and pace zones to those inputs.

## Repository Hygiene Notes

The repo should stay free of generated lockfile copies, rollback backups, and one-off scratch files. Historical planning docs may remain tracked when they are intentionally used as product references, but new temporary exports should be kept out of source control.
