# backend-fresh

Fresh standalone backend that generates run plans from a configurable request contract.

## What It Includes
- New Express service in its own folder.
- Deterministic run-plan generator with:
  - input normalization
  - contract validation
  - pace/HR anchor derivation
  - stock-template selection (`5K`, `10K`, `HALF`, `MARATHON`, `ULTRA`)
  - profile adaptation (difficulty, sessions/week, run days, pace/HR anchors)
  - long-run dominance guardrails (long run remains the largest non-race session)
  - race-week recovery caps (post-race easy runs are capped for safer recovery)
  - phase + progression model
  - session allocation and workout generation
  - race-week insertion using `goal.targetDate`

## API
- `GET /health`
- `POST /generate-run`

## Request Shape
Use `examples/request.json` as the canonical payload.

Top-level keys:
- `athleteProfile` (required)
- `generatorConfig` (optional override knobs)

Optional `athleteProfile` fields for template routing:
- `templateId` (e.g. `10k_10w_4`, `hm_12w_4`, `mar_16w_4`)
- `templateMeta` (pass-through metadata)

## Run
```bash
cd backend-fresh
npm install
npm run dev
```

Default port: `3101` (set `PORT` in `.env`).

## Smoke Test
```bash
cd backend-fresh
npm run smoke
```

## Combination Matrix Test
Runs a large set of goal/week-length/sessions-per-week/difficulty combinations to verify
the stock-template adaptation path works without per-combination templates.

```bash
cd backend-fresh
npm run test:matrix
```

## Example Curl
```bash
curl -sS -X POST 'http://localhost:3101/generate-run' \
  -H 'Content-Type: application/json' \
  --data-binary @examples/request.json
```
