/** Expiry choices offered by Compose, and their mapping to `Paste.expiresAt` (ms epoch or null). */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const EXPIRY_OPTIONS = [
  { id: "10m", label: "10 minutes", ms: 10 * MINUTE },
  { id: "1h", label: "1 hour", ms: HOUR },
  { id: "1d", label: "1 day", ms: DAY },
  { id: "1w", label: "1 week", ms: 7 * DAY },
  { id: "1mo", label: "1 month", ms: 30 * DAY },
  { id: "never", label: "Never", ms: null },
] as const;

export type ExpiryId = (typeof EXPIRY_OPTIONS)[number]["id"];

export const DEFAULT_EXPIRY: ExpiryId = "1w";

export function isExpiryId(value: string): value is ExpiryId {
  return EXPIRY_OPTIONS.some((o) => o.id === value);
}

export function expiresAt(id: ExpiryId, now: number = Date.now()): number | null {
  const option = EXPIRY_OPTIONS.find((o) => o.id === id);
  if (!option) throw new RangeError(`Unknown expiry option: ${id}`);
  return option.ms === null ? null : now + option.ms;
}

/** "3 days", "1 hour", "less than a minute": time left until `expiresAt`, rounded down. */
export function formatTimeLeft(expiresAt: number, now: number = Date.now()): string {
  const left = expiresAt - now;
  const units: [number, string][] = [
    [DAY, "day"],
    [HOUR, "hour"],
    [MINUTE, "minute"],
  ];
  for (const [ms, name] of units) {
    const n = Math.floor(left / ms);
    if (n >= 1) return `${n} ${name}${n === 1 ? "" : "s"}`;
  }
  return "less than a minute";
}
