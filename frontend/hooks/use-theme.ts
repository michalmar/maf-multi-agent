"use client";

import { useCallback, useEffect, useState } from "react";
import type { ThemeMode } from "@/lib/types";

const THEME_STORAGE_KEY = "maf-theme";
const DEFAULT_THEME: ThemeMode = "night";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "daybreak" || value === "night";
}

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return DEFAULT_THEME;
  }

  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeMode(saved)) {
      return saved;
    }
  } catch {
    // localStorage unavailable — continue to DOM/default fallback
  }

  const domTheme = document.documentElement.getAttribute("data-theme");
  return isThemeMode(domTheme) ? domTheme : DEFAULT_THEME;
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

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
