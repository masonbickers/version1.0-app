/**
 * app/(protected)/training/workouts/index.jsx
 * Alias route: /training/workouts -> renders /training (training/index.jsx)
 */

import TrainingIndex from "../index";

export default function WorkoutsIndexAliasPage() {
  return <TrainingIndex />;
}
