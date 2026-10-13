import { readFileSync } from "node:fs";
import preact from "@preact/preset-vite";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { initialFiles } from "./scripts/check-size";
import { securityMetas } from "./scripts/csp";
import { parseRelays } from "./src/core/relayList";

const BASE = "/sealbin/";

/**
 * Lazy chunks link mode needs offline, beyond the shell: the View and Delete screens (Burn,
 * Unlock and ErrorState come with View), the link codec, Argon2 for password links, and Shiki's
 * core + JS engine. Grammars and themes stay runtime-cached.
 */
const OFFLINE_LINK_MODE = [
  /^src\/ui\/screens\/(View|Delete)\.tsx$/,
  /^src\/core\/codec\.ts$/,
  /^node_modules\/hash-wasm\//,
  /^node_modules\/shiki\/dist\/(core|engine-javascript)\.mjs$/,
];

interface ManifestChunk {
  file: string;
  src?: string;
  css?: string[];
  imports?: string[];
}

/** Files of the matching manifest chunks and their static imports. */
function chunkClosure(dist: string, patterns: RegExp[]): Set<string> {
  const manifest = JSON.parse(readFileSync(`${dist}/.vite/manifest.json`, "utf8")) as Record<
    string,
    ManifestChunk
  >;
  const files = new Set<string>();
  const seen = new Set<string>();
  const visit = (key: string) => {
    const chunk = manifest[key];
    if (seen.has(key) || !chunk) return;
    seen.add(key);
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const dep of chunk.imports ?? []) visit(dep);
  };
  for (const [key, chunk] of Object.entries(manifest)) {
    if (chunk.src && patterns.some((p) => p.test(chunk.src ?? ""))) visit(key);
  }
  return files;
}
const relays = parseRelays(process.env.SEALBIN_RELAYS);

/** Build only: the dev server keeps working (HMR needs inline scripts and its own websocket). */
const securityHeaders = (): Plugin => ({
  name: "sealbin-security-metas",
  apply: "build",
  transformIndexHtml: {
    order: "pre",
    handler: (html) => html.replace(/<head>/, `<head>\n    ${securityMetas(relays)}`),
  },
});

export default defineConfig({
  base: BASE,
  build: {
    manifest: true,
    // Fonts stay files: CSP `font-src 'self'` blocks data: URIs.
    assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined),
  },
  plugins: [
    preact(),
    securityHeaders(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script",
      manifest: {
        name: "sealbin",
        short_name: "sealbin",
        description: "Encrypted pastebin that runs entirely in your browser.",
        start_url: BASE,
        scope: BASE,
        display: "standalone",
        background_color: "#fdfcfa",
        theme_color: "#b5482b",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // A new deploy takes over at once: a waiting worker would keep serving the old index.html,
        // whose lazy chunks are gone from the server.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // App shell (html, css, fonts, icons, entry JS closure with CodeMirror) + link mode offline.
        globPatterns: ["**/*.{html,css,woff2,svg,webmanifest}", "**/*.js"],
        globIgnores: ["sw.js", "workbox-*.js"],
        manifestTransforms: [
          (entries) => {
            const shell = new Set([
              ...initialFiles("dist"),
              ...chunkClosure("dist", OFFLINE_LINK_MODE),
            ]);
            const manifest = entries.filter(
              (e) => !e.url.endsWith(".js") || e.url === "registerSW.js" || shell.has(e.url),
            );
            return Promise.resolve({ manifest, warnings: [] });
          },
        ],
        navigateFallback: `${BASE}index.html`,
        runtimeCaching: [
          {
            // Lazy chunks (Shiki grammars/themes, highlight.js, marked, nostr-tools, ...), same origin only.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && url.pathname.startsWith("/sealbin/assets/"),
            handler: "CacheFirst",
            options: {
              cacheName: "sealbin-lazy-chunks",
              expiration: { maxEntries: 400 },
            },
          },
        ],
      },
    }),
  ],
  define: {
    "import.meta.env.SEALBIN_RELAYS": JSON.stringify(process.env.SEALBIN_RELAYS ?? ""),
  },
});
