import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { useAuth } from "./AuthProvider";
import { refreshTrainingWidgetSnapshotForUser } from "../src/widgets/trainingWidgetSnapshot";

export function TrainingWidgetProvider({ children }) {
  const { user } = useAuth();
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    let cancelled = false;

    async function refresh(reason) {
      if (cancelled) return;
      await refreshTrainingWidgetSnapshotForUser({
        userId: user?.uid || null,
        reason,
      }).catch((error) => {
        console.warn("[widgets] snapshot refresh failed:", error?.message || error);
      });
    }

    refresh(user?.uid ? "auth_ready" : "signed_out");

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      const previous = appStateRef.current;
      appStateRef.current = nextState;
      if (previous?.match(/inactive|background/) && nextState === "active") {
        refreshTrainingWidgetSnapshotForUser({
          userId: user?.uid || null,
          reason: "app_foreground",
        }).catch((error) => {
          console.warn("[widgets] foreground refresh failed:", error?.message || error);
        });
      }
    });

    return () => sub.remove();
  }, [user?.uid]);

  return children;
}
