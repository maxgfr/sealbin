/**
 * Language ids are Shiki's (`bundledLanguagesInfo` ids). "" means "none chosen": Compose then
 * auto-detects with highlight.js, and the viewer falls back to plain text.
 * Shiki is only imported lazily (`loadLanguages`) or as types, so it stays out of the entry chunk.
 */
import type { BundledLanguageInfo } from "shiki";

export type LangInfo = Pick<BundledLanguageInfo, "id" | "name" | "aliases">;

/** Extensions whose Shiki id is not the extension itself nor one of its aliases. */
const EXTENSIONS: Record<string, string> = {
  cjs: "javascript",
  mjs: "javascript",
  cts: "typescript",
  mts: "typescript",
  h: "c",
  cc: "cpp",
  cxx: "cpp",
  hh: "cpp",
  hpp: "cpp",
  htm: "html",
  yml: "yaml",
  markdown: "markdown",
  bash: "shellscript",
  zsh: "shellscript",
  kts: "kotlin",
  pyw: "python",
  rs: "rust",
  svg: "xml",
  jsonc: "jsonc",
  ps1: "powershell",
  tf: "hcl",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  ml: "ocaml",
  pl: "perl",
  txt: "",
  text: "",
  log: "",
};

/** Whole filenames that carry a language without an extension. */
const FILENAMES: Record<string, string> = {
  dockerfile: "docker",
  makefile: "make",
  gnumakefile: "make",
  cmakelists: "cmake",
  "cmakelists.txt": "cmake",
  ".bashrc": "shellscript",
  ".zshrc": "shellscript",
  ".profile": "shellscript",
  ".gitignore": "",
  ".env": "dotenv",
};

/** Shiki id for a name that is an id or an alias (case-insensitive), or null. */
export function resolveLang(name: string, infos: readonly LangInfo[]): string | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const hit =
    infos.find((l) => l.id === needle) ?? infos.find((l) => l.aliases?.includes(needle) ?? false);
  return hit ? hit.id : null;
}

/**
 * Language for a filename: whole-name table, then extension table, then the extension as a
 * Shiki id or alias. Returns "" for a known plain-text file and null when nothing matches.
 */
export function langFromFilename(filename: string, infos: readonly LangInfo[]): string | null {
  const base = filename.trim().split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (!base) return null;
  const known = FILENAMES[base];
  if (known !== undefined) return known === "" || resolveLang(known, infos) ? known : null;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1);
  const mapped = EXTENSIONS[ext];
  if (mapped !== undefined) return mapped === "" ? "" : resolveLang(mapped, infos);
  return resolveLang(ext, infos);
}

/** Map a highlight.js language name to a Shiki id, or "" when it has no counterpart. */
export function langFromHljs(name: string | undefined, infos: readonly LangInfo[]): string {
  if (!name || name === "plaintext") return "";
  const aliases: Record<string, string> = { bash: "shellscript", shell: "shellscript" };
  return resolveLang(aliases[name] ?? name, infos) ?? "";
}

export function langLabel(id: string, infos: readonly LangInfo[]): string {
  if (!id) return "Plain text";
  return infos.find((l) => l.id === id)?.name ?? id;
}

let infosPromise: Promise<LangInfo[]> | undefined;
/** Shiki's language list, sorted by display name (lazy chunk). */
export function loadLanguages(): Promise<LangInfo[]> {
  infosPromise ??= import("shiki/langs").then(({ bundledLanguagesInfo }) =>
    bundledLanguagesInfo
      .map(({ id, name, aliases }): LangInfo => (aliases ? { id, name, aliases } : { id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  return infosPromise;
}

/**
 * highlight.js languages auto-detection may pick: common ones only, so prose does not match an
 * obscure grammar. Bash scores high on almost anything with quotes, so shell is detected from a
 * shebang instead (`fromShebang`).
 */
const DETECTABLE = [
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "go",
  "java",
  "javascript",
  "json",
  "kotlin",
  "markdown",
  "php",
  "python",
  "ruby",
  "rust",
  "scss",
  "sql",
  "swift",
  "typescript",
  "xml",
  "yaml",
];
/** Below this highlight.js relevance the guess is noise (prose scores 0–2). */
export const DETECT_MIN_RELEVANCE = 5;
/** The winner must beat the runner-up by this factor, unless both are one family. */
export const DETECT_MARGIN = 1.5;
/** Languages whose syntax nests (JSON is JavaScript, JavaScript is TypeScript…): a close runner-up there is expected. */
const FAMILIES = [
  ["json", "javascript", "typescript"],
  ["c", "cpp"],
  ["css", "scss"],
];
const sameFamily = (a: string, b: string) => FAMILIES.some((f) => f.includes(a) && f.includes(b));

const SHEBANGS: [RegExp, string][] = [
  [/\b(?:ba|z|k|da)?sh\b/, "shellscript"],
  [/\bpython[0-9.]*\b/, "python"],
  [/\bnode\b|\bdeno\b|\bbun\b/, "javascript"],
  [/\bruby\b/, "ruby"],
  [/\bperl\b/, "perl"],
];

/** Language named by a `#!` first line, or null. */
function fromShebang(content: string): string | null {
  if (!content.startsWith("#!")) return null;
  const line = content.split("\n", 1)[0] ?? "";
  return SHEBANGS.find(([re]) => re.test(line))?.[1] ?? null;
}

/** A JSON object or array (highlight.js scores JSON barely above C++). */
function isJsonDocument(content: string): boolean {
  const t = content.trim();
  if (!/^[[{]/.test(t) || t.length > 1_000_000) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * Guess a Shiki id from content with highlight.js `highlightAuto` (lazy chunk). Returns "" (plain
 * text) unless the best guess is relevant enough and clearly ahead of the second best.
 */
export async function detectLang(content: string, infos: readonly LangInfo[]): Promise<string> {
  const exact = fromShebang(content) ?? (isJsonDocument(content) ? "json" : null);
  if (exact) return resolveLang(exact, infos) ?? "";
  const { default: hljs } = await import("highlight.js/lib/common");
  // highlightAuto is linear in input size; a sample is enough to guess.
  const best = hljs.highlightAuto(content.slice(0, 20_000), DETECTABLE);
  if (!best.language || best.relevance < DETECT_MIN_RELEVANCE) return "";
  const second = best.secondBest;
  if (
    second?.language &&
    !sameFamily(best.language, second.language) &&
    best.relevance < second.relevance * DETECT_MARGIN
  ) {
    return "";
  }
  return langFromHljs(best.language, infos);
}
