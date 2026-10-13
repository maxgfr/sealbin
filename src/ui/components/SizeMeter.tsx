/**
 * Live size of the paste once sealed. The bar fills toward the real limit (MAX_PASTE_BYTES, the
 * same in both modes; short links are split into as many relay events as needed). Link mode shows
 * the link length and, past 2,000 characters, a hint that a short link stays short; that is not
 * a limit. Measured by compressing the same JSON Compose seals (debounced), without encrypting.
 */
import { useEffect, useState } from "preact/hooks";
import type { Paste } from "../../core/codec";
import {
  deflatedSize,
  formatSize,
  linkLength,
  linkState,
  MAX_PASTE_BYTES,
  type MeterState,
  nostrChunks,
  nostrContentLength,
  nostrState,
  pasteBytes,
  sealedBytes,
  tooLargeText,
} from "../lib/size";
import { baseUrl } from "../routes";

const DEBOUNCE_MS = 250;

export function SizeMeter({
  paste,
  password,
  mode,
  onShortLink,
}: {
  paste: Paste;
  password: boolean;
  mode: "link" | "nostr";
  /** Switches Compose to short-link mode; offered when the link gets long. */
  onShortLink?: () => void;
}) {
  const [compressed, setCompressed] = useState<number | null>(null);
  const json = JSON.stringify(paste);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      deflatedSize(json).then(
        (n) => live && setCompressed(n),
        (err: unknown) => {
          console.warn("sealbin: size estimate failed", err);
          if (live) setCompressed(null);
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [json]);

  if (compressed === null || paste.content === "") return null;
  const sealed = sealedBytes(compressed, password);
  const bytes = pasteBytes(json);
  const tooLarge =
    tooLargeText(bytes) ??
    `Too large to share: the limit is ${formatSize(MAX_PASTE_BYTES)}. Shorten it.`;
  let label: string;
  let state: MeterState;
  let message: string;
  let switchToShort = false;
  if (mode === "link") {
    const length = linkLength(baseUrl(location).length, sealed);
    label = `${length.toLocaleString("en")} chars`;
    state = linkState(length, bytes);
    switchToShort = state === "warning" && onShortLink !== undefined;
    message =
      state === "error"
        ? tooLarge
        : state === "warning"
          ? "Long link. Some chat apps cut links this long; a short link stays short."
          : "Link length";
  } else {
    const length = nostrContentLength(sealed);
    const chunks = nostrChunks(length);
    label = `${formatSize(bytes)} of ${formatSize(MAX_PASTE_BYTES)}`;
    state = nostrState(length, bytes);
    message =
      state === "error"
        ? tooLarge
        : chunks > 1
          ? `Encrypted size on relays, stored as ${chunks} events`
          : "Encrypted size on relays";
  }
  const pct = Math.min(100, (bytes / MAX_PASTE_BYTES) * 100);
  return (
    <div
      class="sb-size-meter"
      // A long link is a calm hint, not a warning: links have no hard length limit.
      data-state={
        state === "ok" ? undefined : mode === "link" && state === "warning" ? "hint" : state
      }
    >
      <div class="sb-size-meter__track" aria-hidden="true">
        <div class="sb-size-meter__fill" style={{ width: `${pct}%` }} />
      </div>
      <span>{label}</span>
      <span class="sb-size-meter__message">{message}</span>
      {switchToShort && (
        <button type="button" class="sb-button" onClick={onShortLink}>
          Use a short link
        </button>
      )}
    </div>
  );
}
