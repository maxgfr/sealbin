import preact from "@preact/preset-vite";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { initialFiles } from "./scripts/check-size";
import { securityMetas } from "./scripts/csp";
import { parseRelays } from "./src/core/relayList";

const BASE = "/sealbin/";
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
        // App shell only: html, css, fonts, icons and the entry JS closure (CodeMirror included).
        globPatterns: ["**/*.{html,css,woff2,svg,webmanifest}", "**/*.js"],
        globIgnores: ["sw.js", "workbox-*.js"],
        manifestTransforms: [
          (entries) => {
            const shell = new Set(initialFiles("dist"));
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
