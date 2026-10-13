/**
 * Live size of the paste once sealed: link length against the 2,000-character warning in link
 * mode, event content against the 60,000-character cap in short-link mode. Measured by
 * compressing the same JSON Compose seals (debounced), without encrypting anything.
 */
import { useEffect, useState } from "preact/hooks";
import type { Paste } from "../../core/codec";
import {
  deflatedSize,
  LINK_WARN_CHARS,
  linkLength,
  linkState,
  type MeterState,
  NOSTR_MAX_CHARS,
  nostrContentLength,
  nostrState,
  sealedBytes,
} from "../lib/size";
import { baseUrl } from "../routes";

const DEBOUNCE_MS = 250;

export function SizeMeter({
  paste,
  password,
  mode,
}: {
  paste: Paste;
  password: boolean;
  mode: "link" | "nostr";
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
  let value: number;
  let limit: number;
  let state: MeterState;
  let message: string;
  if (mode === "link") {
    value = linkLength(baseUrl(location).length, sealed);
    limit = LINK_WARN_CHARS;
    state = linkState(value);
    message =
      state === "ok"
        ? "Link length"
        : "Long link: some apps cut links over 2,000 characters. A short link stays short.";
  } else {
    value = nostrContentLength(sealed);
    limit = NOSTR_MAX_CHARS;
    state = nostrState(value);
    message =
      state === "error"
        ? "Too large for a short link. Shorten it, or share it as a link."
        : "Encrypted size on relays";
  }
  const pct = Math.min(100, (value / limit) * 100);
  return (
    <div class="sb-size-meter" data-state={state === "ok" ? undefined : state}>
      <div class="sb-size-meter__track" aria-hidden="true">
        <div class="sb-size-meter__fill" style={{ width: `${pct}%` }} />
      </div>
      <span>
        {value.toLocaleString("en")} / {limit.toLocaleString("en")} chars
      </span>
      <span class="sb-size-meter__message">{message}</span>
    </div>
  );
}
