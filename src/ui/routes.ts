/**
 * UI routing over the hash formats of `core/link.ts`.
 * `route` holds the parsed current hash; `startRouter` keeps it in sync with `hashchange`.
 * Share and delete URLs are built from the page's origin + pathname, so they work under the
 * Pages base path (`/sealbin/`) and in dev alike.
 */
import { signal } from "@preact/signals";
import { parseRoute, type Route, serializeRoute } from "../core/link";

export type { Route };

/** The subset of `Location` the URL helpers need. */
export interface LocationLike {
  origin: string;
  pathname: string;
}

export const route = signal<Route>(parseRoute(globalThis.location?.hash ?? ""));

/**
 * Bumped when the reader navigates again to the route already shown (the same link reopened
 * after `dropFragment`, Home while on Home). Part of the screen key, so the screen remounts.
 * A change of `&L` lines alone does not bump it.
 */
export const visit = signal(0);

/** Subscribe `route` to the window's hash; returns the unsubscribe function. */
export function startRouter(win: Window = window): () => void {
  const sync = () => {
    const next = parseRoute(win.location.hash);
    if (serializeRoute(next) === serializeRoute(route.value)) visit.value++;
    route.value = next;
  };
  // A link to the hash already shown (the brand link while home) fires no hashchange: count the
  // click as a new visit, unless the link only selects lines or something else handled it.
  const click = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const link = (e.target as Element | null)?.closest?.("a[href^='#']");
    const href = link?.getAttribute("href");
    if (!link || link.hasAttribute("target") || href !== win.location.hash) return;
    const next = parseRoute(href);
    if ("lines" in next && next.lines) return;
    visit.value++;
    route.value = next;
  };
  sync();
  win.addEventListener("hashchange", sync);
  win.addEventListener("click", click);
  return () => {
    win.removeEventListener("hashchange", sync);
    win.removeEventListener("click", click);
  };
}

/** Go to a route. `replace` rewrites the history entry (used to drop secrets from the URL). */
export function navigate(to: Route, opts: { replace?: boolean; win?: Window } = {}): void {
  const win = opts.win ?? window;
  const hash = serializeRoute(to);
  if (opts.replace) {
    win.history.replaceState(win.history.state, "", hash);
    route.value = parseRoute(hash);
  } else if (win.location.hash === hash) {
    // Same hash: no hashchange fires. Remount, unless this only re-selects the same lines.
    if (!("lines" in to && to.lines)) visit.value++;
    route.value = parseRoute(hash);
  } else {
    win.location.hash = hash;
  }
}

/**
 * Remove the fragment from the URL (history entry included) without touching `route`: the
 * current screen stays mounted. Used to drop a secret from the address bar (burn read, delete
 * screen) while the screen keeps what it shows. With no fragment left, a later `#/` link still
 * fires hashchange, and a reload opens Compose.
 */
export function dropFragment(win: Window = window): void {
  win.history.replaceState(win.history.state, "", `${win.location.pathname}${win.location.search}`);
}

/** The app's base URL: origin + pathname, without query or fragment. */
export function baseUrl(loc: LocationLike): string {
  return `${loc.origin}${loc.pathname}`;
}

/** Absolute URL for a route, e.g. a share link `https://…/sealbin/#/n/…`. */
export function routeUrl(to: Route, loc: LocationLike): string {
  return `${baseUrl(loc)}${serializeRoute(to)}`;
}

/**
 * Stable identity for a route, used to remount screens when the route changes. The `&L` line
 * range is left out: selecting lines updates the open paste instead of reloading it.
 */
export function routeKey(r: Route): string {
  if ((r.kind === "link" || r.kind === "nostr") && r.lines) {
    const { lines: _, ...rest } = r;
    return serializeRoute(rest);
  }
  return serializeRoute(r);
}
