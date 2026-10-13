import { parseRelays } from "./relayList";

export { DEFAULT_RELAYS, parseRelays } from "./relayList";

/** Effective relays: build-time `SEALBIN_RELAYS` override (vite `define`), else the defaults. */
export const RELAYS: readonly string[] = parseRelays(import.meta.env.SEALBIN_RELAYS);
