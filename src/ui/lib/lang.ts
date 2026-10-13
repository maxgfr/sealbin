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

/** Guess a Shiki id from content with highlight.js `highlightAuto` (lazy chunk). */
export async function detectLang(content: string, infos: readonly LangInfo[]): Promise<string> {
  const { default: hljs } = await import("highlight.js/lib/common");
  // highlightAuto is linear in input size; a sample is enough to guess.
  return langFromHljs(hljs.highlightAuto(content.slice(0, 20_000)).language, infos);
}
