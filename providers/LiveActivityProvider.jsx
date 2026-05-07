import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, onSnapshot } from "firebase/firestore";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { auth, db } from "../firebaseConfig";

const LIVE_ACTIVITY_KEY = "@live_activity_v1";

const LiveActivityCtx = createContext({
  hydrated: false,
  liveActivity: null,
  setLiveActivity: (_next) => {},
  clearLiveActivity: () => {},
});

export function LiveActivityProvider({ children }) {
  const [hydrated, setHydrated] = useState(false);
  const [liveActivity, setLiveActivityState] = useState(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(LIVE_ACTIVITY_KEY);
        if (!active) return;
        if (!raw) {
          setLiveActivityState(null);
          return;
        }

        const parsed = JSON.parse(raw);
        setLiveActivityState(parsed && typeof parsed === "object" ? parsed : null);
      } catch {
        if (active) setLiveActivityState(null);
      } finally {
        if (active) setHydrated(true);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const setLiveActivity = useCallback((next) => {
    setLiveActivityState((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      const normalised = resolved && typeof resolved === "object" ? resolved : null;

      if (normalised) {
        AsyncStorage.setItem(LIVE_ACTIVITY_KEY, JSON.stringify(normalised)).catch(() => {});
      } else {
        AsyncStorage.removeItem(LIVE_ACTIVITY_KEY).catch(() => {});
      }

      return normalised;
    });
  }, []);

  const clearLiveActivity = useCallback(() => {
    setLiveActivity(null);
  }, [setLiveActivity]);

  useEffect(() => {
    if (!hydrated) return undefined;
    if (!liveActivity?.isActive) return undefined;

    const uid = String(auth.currentUser?.uid || "").trim();
    const sessionKey = String(liveActivity?.sessionKey || "").trim();
    if (!uid || !sessionKey) return undefined;

    const unsub = onSnapshot(
      doc(db, "users", uid, "sessionLogs", sessionKey),
      (snap) => {
        if (!snap.exists()) return;
        const log = snap.data() || {};
        const status = String(log?.status || "").trim().toLowerCase();
        const isResolved =
          status === "completed" ||
          status === "skipped" ||
          !!log?.completedAt ||
          !!log?.skippedAt ||
          !!String(log?.lastTrainSessionId || "").trim();

        if (isResolved) clearLiveActivity();
      },
      () => {}
    );

    return () => {
      unsub();
    };
  }, [clearLiveActivity, hydrated, liveActivity?.isActive, liveActivity?.sessionKey]);

  const value = useMemo(
    () => ({
      hydrated,
      liveActivity,
      setLiveActivity,
      clearLiveActivity,
    }),
    [hydrated, liveActivity, setLiveActivity, clearLiveActivity]
  );

  return <LiveActivityCtx.Provider value={value}>{children}</LiveActivityCtx.Provider>;
}

export function useLiveActivity() {
  return useContext(LiveActivityCtx);
}
