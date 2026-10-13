/** Public Nostr relays used for short links (same list as veil's DEFAULT_RELAYS). */
export const DEFAULT_RELAYS: readonly string[] = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
];

/**
 * Parses a comma-separated relay list; blank entries are dropped, nothing left → defaults.
 * No `import.meta.env` here: `vite.config.ts` imports this module under Vite's config loader.
 */
export function parseRelays(raw: string | undefined): readonly string[] {
  const list = (raw ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url !== "");
  return list.length > 0 ? list : DEFAULT_RELAYS;
}
