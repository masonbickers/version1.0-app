# Draft 1 User Test Checklist

Use a fresh test account where possible.

## 1. Onboarding
- Create or sign into a test user.
- Complete onboarding with profile, goal, preferred training days, current ability, nutrition goal, and connected app preferences.
- Confirm completion opens Home.
- Confirm relaunching the app does not show onboarding again.

## 2. Home
- Confirm Home is the main landing screen.
- Confirm the hero shows the next actionable session.
- Tap Start session for an incomplete session, or View session for a completed one.
- Confirm Readiness, Calendar, Coach, Fuel, and Progress quick actions open the expected screens.

## 3. Training
- Create a training plan from Train.
- Open the generated plan from the plan view.
- Start the next session from Home or Train.
- Complete or skip the session.
- Confirm `users/{uid}/trainSessions` receives the saved session.
- Confirm `users/{uid}/sessionLogs/{sessionKey}` updates with status and `lastTrainSessionId`.
- Return to Home and confirm the button changes to View session when completed.

## 4. Readiness
- Open Readiness from Home.
- Save sleep, soreness, energy, stress, motivation, and injury flag.
- Confirm the check-in saves and can be reopened for the same day.

## 5. Nutrition
- Open Fuel and Today.
- Add a manual meal and confirm it appears on Today and Nutrition index.
- Edit the meal and confirm calories/macros update everywhere.
- Use Food Quality after at least one meal is logged.
- Test Meal Scan, Barcode Result, and Voice Log where device/API support is available.
- Confirm all nutrition entries save to `users/{uid}/meals` with `date`, `dateKey`, `mealType`, calories, protein, carbs, fat, source, `createdAt`, and `updatedAt`.

## 6. Progress
- Open Progress after at least one completed session.
- Confirm PR snapshot, weekly consistency, running benchmark, strength benchmark, and goal progress render.
- Confirm empty state is clear when there are no sessions.

## 7. Chat Review
- Ask: "Review today and tell me what to do next."
- Confirm the coach response references active plan, today's session, recent sessions, nutrition or meal context, and weight if available.
- Ask a nutrition-specific question and confirm meal/target context is used.
