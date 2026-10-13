/**
 * Delete screen for `#/d/…` (owner key + paste id). The fragment is removed from the URL on arrival, so
 * the owner key leaves the address bar and the history at once; this screen keeps it in memory
 * until the reader confirms or leaves.
 */
import { useEffect, useState } from "preact/hooks";
import type { Route } from "../../core/link";
import { describeError } from "../lib/errors";
import { dropFragment, navigate } from "../routes";

type DeleteRoute = Extract<Route, { kind: "delete" }>;

type State =
  | { s: "confirm" }
  | { s: "deleting" }
  | { s: "deleted"; relays: number }
  | { s: "error"; error: unknown };

export function Delete({ route }: { route: DeleteRoute }) {
  const [state, setState] = useState<State>({ s: "confirm" });

  useEffect(() => {
    dropFragment();
  }, []);

  async function destroy() {
    setState({ s: "deleting" });
    try {
      const { deletePaste } = await import("../../core/nostr");
      const { acceptedBy } = await deletePaste(route.ownerKey, route.nostrId);
      setState({ s: "deleted", relays: acceptedBy.length });
    } catch (err) {
      setState({ s: "error", error: err });
    }
  }

  if (state.s === "deleted") {
    return (
      <section class="sb-interstitial" aria-labelledby="sb-delete-title" role="status">
        <h1 id="sb-delete-title" class="sb-interstitial__title">
          Paste deleted
        </h1>
        <p class="sb-interstitial__body">
          {state.relays === 1 ? "1 relay" : `${state.relays} relays`} accepted the deletion. Relays
          that missed it drop the paste when it expires.
        </p>
        <div class="sb-interstitial__actions">
          <button
            type="button"
            class="sb-button sb-button--primary"
            onClick={() => navigate({ kind: "home" })}
          >
            New paste
          </button>
        </div>
      </section>
    );
  }

  const error = state.s === "error" ? describeError(state.error) : null;
  return (
    <section
      class="sb-interstitial sb-interstitial--warning"
      aria-labelledby="sb-delete-title"
      aria-busy={state.s === "deleting"}
    >
      <h1 id="sb-delete-title" class="sb-interstitial__title">
        Delete this paste?
      </h1>
      <p class="sb-interstitial__body">
        Its short link stops working for everyone. This cannot be undone.
      </p>
      {error && (
        <p class="sb-notice sb-notice--error" role="alert">
          <strong>{error.title}.</strong> {error.body}
        </p>
      )}
      <div class="sb-interstitial__actions">
        <button
          type="button"
          class="sb-button sb-button--danger"
          disabled={state.s === "deleting"}
          onClick={() => void destroy()}
        >
          {state.s === "deleting" ? "Deleting…" : error ? "Try again" : "Delete paste"}
        </button>
        <button type="button" class="sb-button" onClick={() => navigate({ kind: "home" })}>
          Keep it
        </button>
      </div>
    </section>
  );
}
