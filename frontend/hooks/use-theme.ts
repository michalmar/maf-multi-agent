"use client";

import { useCallback, useEffect, useState } from "react";
import type { ThemeMode } from "@/lib/types";

const THEME_STORAGE_KEY = "maf-theme";

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>("daybreak");

  // Restore saved theme on mount
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === "daybreak" || saved === "night") {
        setTheme(saved);
      }
    } catch {
      // localStorage unavailable — use default
    }
  }, []);

  // Persist theme and update data attribute
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // localStorage unavailable
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "night" ? "daybreak" : "night"));
  }, []);

  return { theme, toggleTheme } as const;
}
