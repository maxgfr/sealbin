/**
 * Content Security Policy for the built site, injected as a `<meta>` by the
 * Vite plugin in `vite.config.ts`. `connect-src` is built from the same relay
 * list the app uses (`src/core/relays.ts`, `SEALBIN_RELAYS` override).
 */

/** Builds the CSP string; `relays` become the only cross-origin `connect-src` entries. */
export function buildCsp(relays: readonly string[]): string {
  const connect = ["'self'", ...relays].join(" ");
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    `connect-src ${connect}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

const escapeAttr = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** The security `<meta>` tags placed at the top of `<head>`. */
export function securityMetas(relays: readonly string[]): string {
  return [
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(buildCsp(relays))}" />`,
    '<meta name="referrer" content="no-referrer" />',
  ].join("\n    ");
}
