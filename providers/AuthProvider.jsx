// app/providers/AuthProvider.jsx
import { onAuthStateChanged, signOut, updateCurrentUser } from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { auth } from "../firebaseConfig";

const AuthCtx = createContext({
  user: null,
  loading: true,
  error: null,
  refreshUser: async () => {},
  signOutAsync: async () => {},
});

export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // true until first auth tick
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    // This subscribes to Firebase auth state and restores the user
    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        if (!isMounted) return;
        setUser(u ?? null); // u is null if signed out
        setLoading(false);  // first tick complete
      },
      (e) => {
        if (!isMounted) return;
        setError(e);
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      unsub();
    };
  }, []);

  const refreshUser = async () => {
    if (!auth.currentUser) return;
    try {
      await auth.currentUser.reload();
      await updateCurrentUser(auth, auth.currentUser);
    } catch (e) {
      console.warn("refreshUser failed:", e?.message || e);
    }
  };

  const signOutAsync = async () => {
    try {
      await signOut(auth); // <- this clears the persisted session
    } catch (e) {
      console.warn("signOut failed:", e?.message || e);
    }
  };

  const value = useMemo(
    () => ({ user, loading, error, refreshUser, signOutAsync }),
    [user, loading, error]
  );

return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}


