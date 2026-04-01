// app/providers/ThemeProvider.jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Appearance } from "react-native";
import { PALETTES, RADIUS, SPACING, TYPOGRAPHY } from "./theme-tokens";

const THEME_KEY = "@theme"; // "light" | "dark" | "system"

const ThemeCtx = createContext({
  theme: "system",        // "light" | "dark" | "system"
  setTheme: (_v) => {},
  colors: PALETTES.light, // will be overridden at runtime
  isDark: false,
  radius: RADIUS,
  spacing: SPACING,
  typography: TYPOGRAPHY,
});

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState("system"); // "light" | "dark" | "system"
  const sys = Appearance.getColorScheme();      // "light" | "dark" | null

  // load persisted theme once
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(THEME_KEY);
        if (saved) setTheme(saved);
      } catch {
        // ignore
      }
    })();
  }, []);

  // persist on change
  useEffect(() => {
    AsyncStorage.setItem(THEME_KEY, theme).catch(() => {});
  }, [theme]);

  // react to system changes only if theme === "system"
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      if (theme === "system") {
        // bump state to recompute activeScheme
        setTheme((t) => t);
      }
    });
    return () => sub.remove();
  }, [theme]);

  const activeScheme = theme === "system" ? (sys || "light") : theme;
  const colors =
    activeScheme === "dark" ? PALETTES.dark : PALETTES.light;
  const isDark = activeScheme === "dark";

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      colors,
      isDark,
      radius: RADIUS,
      spacing: SPACING,
      typography: TYPOGRAPHY,
    }),
    [theme, colors, isDark]
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}
