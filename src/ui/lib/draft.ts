/**
 * Prefill for Compose. A screen that wants to open Compose with content (Fork) sets
 * `composeDraft.value` and then navigates home; Compose takes the draft once on mount and clears
 * it. Fields left out keep Compose's defaults. Memory only: drafts never touch storage.
 */
import { signal } from "@preact/signals";
import type { Paste } from "../../core/codec";

export type ComposeDraft = Partial<Pick<Paste, "title" | "filename" | "lang" | "content">>;

export const composeDraft = signal<ComposeDraft | null>(null);

/** Read and clear the pending draft. */
export function takeDraft(): ComposeDraft | null {
  const draft = composeDraft.value;
  composeDraft.value = null;
  return draft;
}
