/** Hex helpers with no dependencies, so the routing code in the entry chunk stays small. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
