/**
 * Raw view and download. Both go through a `text/plain` blob: URL, so the paste is never
 * interpreted as HTML and never leaves the browser.
 */

/** File extensions for Shiki ids whose usual extension differs from the id. */
const EXTENSIONS: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  tsx: "tsx",
  jsx: "jsx",
  python: "py",
  rust: "rs",
  ruby: "rb",
  markdown: "md",
  shellscript: "sh",
  powershell: "ps1",
  kotlin: "kt",
  csharp: "cs",
  cpp: "cpp",
  "objective-c": "m",
  haskell: "hs",
  elixir: "ex",
  erlang: "erl",
  ocaml: "ml",
  perl: "pl",
  yaml: "yml",
  docker: "Dockerfile",
  make: "Makefile",
  latex: "tex",
  golang: "go",
  vue: "vue",
  hcl: "tf",
  dotenv: "env",
};

/** Extension for a Shiki language id: "txt" for plain text. */
export function extensionFor(lang: string): string {
  if (!lang) return "txt";
  return EXTENSIONS[lang] ?? lang.replace(/[^a-z0-9]+/gi, "");
}

/** Characters reserved in filenames on common systems; control characters are replaced too. */
const RESERVED = /[\\/:*?"<>|]/g;

function safeFilename(name: string): string {
  return Array.from(name.replace(RESERVED, "_"), (ch) => (ch.charCodeAt(0) < 0x20 ? "_" : ch)).join(
    "",
  );
}

/** Name for the downloaded file: the paste's filename, else `paste.<ext>` from its language. */
export function downloadName(paste: { filename: string; lang: string }): string {
  const base = paste.filename.trim().split(/[\\/]/).pop() ?? "";
  const own = safeFilename(base);
  if (own && own !== "." && own !== "..") return own;
  const ext = extensionFor(paste.lang);
  if (ext === "Dockerfile" || ext === "Makefile") return ext;
  return `paste.${ext || "txt"}`;
}

/** A `text/plain` blob: URL for `content`. The caller revokes it. */
export function textBlobUrl(content: string): string {
  return URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
}

/** How long a raw/download blob: URL stays valid; the new tab or the download has started by then. */
const REVOKE_AFTER_MS = 60_000;

/** Open the content as plain text in a new tab. */
export function openRaw(content: string): void {
  const url = textBlobUrl(content);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/** Save the content as a file named `name`. */
export function saveText(content: string, name: string): void {
  const url = textBlobUrl(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
