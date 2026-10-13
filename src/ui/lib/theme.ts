/**
 * Page theme (light / dark / follow the system) and the code theme used by the viewer.
 * The choice is saved in localStorage under its own key and holds nothing but these two names:
 * paste data never touches storage. Storage can be unavailable (private mode, blocked site data),
 * in which case the choice lasts for the session only.
 */
import { computed, signal } from "@preact/signals";

export type ColorScheme = "system" | "light" | "dark";

export const COLOR_SCHEMES: readonly { id: ColorScheme; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/** "auto" follows the page: github-light or github-dark. Other ids are Shiki theme ids. */
export const CODE_THEMES: readonly { id: string; label: string }[] = [
  { id: "auto", label: "Match page" },
  { id: "github-light", label: "GitHub Light" },
  { id: "github-dark", label: "GitHub Dark" },
  { id: "one-light", label: "One Light" },
  { id: "one-dark-pro", label: "One Dark Pro" },
  { id: "solarized-light", label: "Solarized Light" },
  { id: "solarized-dark", label: "Solarized Dark" },
  { id: "vitesse-light", label: "Vitesse Light" },
  { id: "vitesse-dark", label: "Vitesse Dark" },
  { id: "nord", label: "Nord" },
  { id: "dracula", label: "Dracula" },
  { id: "tokyo-night", label: "Tokyo Night" },
];

export interface ThemePref {
  scheme: ColorScheme;
  code: string;
}

export const THEME_STORAGE_KEY = "sealbin:theme";
const DEFAULT_PREF: ThemePref = { scheme: "system", code: "auto" };

function isScheme(x: unknown): x is ColorScheme {
  return COLOR_SCHEMES.some((s) => s.id === x);
}

function isCodeTheme(x: unknown): x is string {
  return CODE_THEMES.some((t) => t.id === x);
}

/** Parse a stored value; anything unexpected falls back to the defaults field by field. */
export function parseThemePref(raw: string | null): ThemePref {
  if (!raw) return DEFAULT_PREF;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // a hand-edited or foreign value: ignore it like a missing one
    return DEFAULT_PREF;
  }
  const obj = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  return {
    scheme: isScheme(obj.scheme) ? obj.scheme : DEFAULT_PREF.scheme,
    code: isCodeTheme(obj.code) ? obj.code : DEFAULT_PREF.code,
  };
}

function readStored(): ThemePref {
  try {
    return parseThemePref(globalThis.localStorage?.getItem(THEME_STORAGE_KEY) ?? null);
  } catch (err) {
    console.warn("sealbin: theme preference unavailable, using defaults", err);
    return DEFAULT_PREF;
  }
}

export const themePref = signal<ThemePref>(readStored());

const darkQuery = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
const systemDark = signal(darkQuery?.matches ?? false);
darkQuery?.addEventListener("change", (e) => {
  systemDark.value = e.matches;
});

/** Whether the page currently renders dark. */
export const isDark = computed(() =>
  themePref.value.scheme === "system" ? systemDark.value : themePref.value.scheme === "dark",
);

/** Shiki theme id for the viewer. */
export const codeTheme = computed(() => {
  const { code } = themePref.value;
  if (code !== "auto") return code;
  return isDark.value ? "github-dark" : "github-light";
});

/** Reflect the scheme on `<html data-theme>`; "system" removes the attribute. */
export function applyTheme(pref: ThemePref = themePref.value, root = document.documentElement) {
  if (pref.scheme === "system") delete root.dataset.theme;
  else root.dataset.theme = pref.scheme;
}

export function setThemePref(next: Partial<ThemePref>): void {
  const pref = { ...themePref.value, ...next };
  themePref.value = pref;
  applyTheme(pref);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(pref));
  } catch (err) {
    console.warn("sealbin: could not save the theme preference", err);
  }
}
