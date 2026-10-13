/**
 * Syntax highlighting for the viewer (and the code theme's colours for the editor), with Shiki's core build and its JavaScript regex engine
 * (no Oniguruma Wasm). Shiki, each grammar and each theme are imported on demand, so none of them
 * reach the entry chunk. Above the size limits the viewer shows plain text instead.
 */
import type { HighlighterCore, ThemedToken, ThemeRegistrationResolved } from "shiki/core";

export const HIGHLIGHT_MAX_BYTES = 500 * 1024;
export const HIGHLIGHT_MAX_LINES = 20_000;

/** Lines of `content`; a single trailing newline does not add an empty last line. */
export function splitLines(content: string): string[] {
  const lines = content.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Why `content` is too large to highlight, or null when it is within the limits. */
export function highlightLimit(content: string): "bytes" | "lines" | null {
  // UTF-8 is at most 3 bytes per UTF-16 unit: skip the encode when it cannot exceed the limit.
  if (content.length * 3 > HIGHLIGHT_MAX_BYTES) {
    if (new TextEncoder().encode(content).length > HIGHLIGHT_MAX_BYTES) return "bytes";
  }
  return splitLines(content).length > HIGHLIGHT_MAX_LINES ? "lines" : null;
}

export interface HighlightResult {
  lines: ThemedToken[][];
  fg: string | undefined;
  bg: string | undefined;
}

let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= Promise.all([import("shiki/core"), import("shiki/engine/javascript")]).then(
    ([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
      createHighlighterCore({ themes: [], langs: [], engine: createJavaScriptRegexEngine() }),
  );
  return highlighter;
}

/** Loads code theme `theme` (github-light for an unknown id); returns the id it loaded. */
async function loadThemeInto(hl: HighlighterCore, theme: string): Promise<string> {
  const { bundledThemes } = await import("shiki/themes");
  const themeName = Object.hasOwn(bundledThemes, theme) ? theme : "github-light";
  const loadTheme = bundledThemes[themeName as keyof typeof bundledThemes];
  if (!hl.getLoadedThemes().includes(themeName)) await hl.loadTheme(loadTheme);
  return themeName;
}

/** Code theme `theme`, resolved: its background, foreground and TextMate token rules. */
export async function codeThemeDefinition(theme: string): Promise<ThemeRegistrationResolved> {
  const hl = await getHighlighter();
  return hl.getTheme(await loadThemeInto(hl, theme));
}

/** Tokens for `content` in Shiki language `lang` and theme `theme`; null for an unknown language. */
export async function highlight(
  content: string,
  lang: string,
  theme: string,
): Promise<HighlightResult | null> {
  const [hl, { bundledLanguages }] = await Promise.all([getHighlighter(), import("shiki/langs")]);
  const loadLang = Object.hasOwn(bundledLanguages, lang)
    ? bundledLanguages[lang as keyof typeof bundledLanguages]
    : undefined;
  if (!loadLang) return null;
  const themeName = await loadThemeInto(hl, theme);
  if (!hl.getLoadedLanguages().includes(lang)) await hl.loadLanguage(loadLang);
  const { tokens, fg, bg } = hl.codeToTokens(content, { lang, theme: themeName });
  return { lines: tokens, fg, bg };
}
