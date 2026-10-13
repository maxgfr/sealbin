/**
 * Bundle budget: the entry chunk plus everything it imports statically
 * (CodeMirror included) must stay under 200 KB gzip. Lazy chunks (Shiki,
 * highlight.js, marked + DOMPurify, nostr-tools, hash-wasm, uqr) are reported
 * but not counted. Reads Vite's build manifest (`dist/.vite/manifest.json`).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const BUDGET_GZIP = 200 * 1024;

interface ManifestChunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  css?: string[];
}

/** Output files (relative to `dist`) of the entry chunks and their static import closure. */
export function initialFiles(dist: string): string[] {
  const manifest = JSON.parse(readFileSync(join(dist, ".vite/manifest.json"), "utf8")) as Record<
    string,
    ManifestChunk
  >;
  const seen = new Set<string>();
  const files = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`manifest has no chunk ${key}`);
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const dep of chunk.imports ?? []) visit(dep);
  };
  const entries = Object.keys(manifest).filter((key) => manifest[key]?.isEntry);
  if (entries.length === 0) throw new Error("manifest has no entry chunk");
  for (const key of entries) visit(key);
  return [...files];
}

const gz = (file: string) => gzipSync(readFileSync(file), { level: 9 }).length;
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1).padStart(7)} KB`;

if (import.meta.main) {
  const dist = fileURLToPath(new URL("../dist", import.meta.url));
  const initial = new Set(initialFiles(dist).filter((f) => f.endsWith(".js")));
  let total = 0;
  for (const f of readdirSync(join(dist, "assets")).sort()) {
    const rel = `assets/${f}`;
    const size = gz(join(dist, rel));
    const tag = initial.has(rel) ? "initial" : f.endsWith(".js") ? "lazy" : "asset";
    if (tag === "initial") total += size;
    console.log(`${tag.padEnd(8)} ${kb(size)} gz  ${f}`);
  }
  console.log(`initial JS: ${kb(total).trim()} gzip (budget ${BUDGET_GZIP / 1024} KB)`);
  if (total > BUDGET_GZIP) {
    console.error("over budget");
    process.exit(1);
  }
}
