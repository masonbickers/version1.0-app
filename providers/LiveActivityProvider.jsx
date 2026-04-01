import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

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
