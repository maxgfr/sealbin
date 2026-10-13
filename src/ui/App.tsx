/**
 * App shell: header, routed screen, toast region.
 *
 * Header: brand, a spacer, then `.sb-header__actions` (theme picker, keyboard shortcuts help).
 * Screens: Compose and NotFound are in the entry chunk; View (link/nostr routes) and Delete
 * are loaded on demand from `./screens/View` and `./screens/Delete`, each receiving `{ route }`.
 * A screen remounts whenever the route changes (keyed by the serialized route, minus `&L` lines)
 * and when the reader navigates again to the route already shown (`visit`).
 * A lazy screen that fails to load after a new deploy (its old chunk is gone) asks the service
 * worker for the new version and reloads once; a second failure shows the error with a reload.
 */
import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Route } from "../core/link";
import { Shortcuts } from "./components/Shortcuts";
import { ThemePicker } from "./components/ThemePicker";
import { ToastRegion } from "./components/Toast";
import { route, routeKey, visit } from "./routes";
import { Compose } from "./screens/Compose";
import { NotFound } from "./screens/NotFound";

type ViewRoute = Extract<Route, { kind: "link" | "nostr" }>;
type DeleteRoute = Extract<Route, { kind: "delete" }>;

const loadView = () => import("./screens/View").then((m) => m.View);
const loadDelete = () => import("./screens/Delete").then((m) => m.Delete);

/** sessionStorage flag: set before the one automatic reload, cleared when a screen loads. */
const RELOADED = "sb-reloaded-for-update";

function reloadedOnce(): boolean {
  try {
    return sessionStorage.getItem(RELOADED) !== null;
  } catch {
    // Storage blocked: never auto-reload, since the loop guard could not hold.
    return true;
  }
}

function setReloaded(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(RELOADED, "1");
    else sessionStorage.removeItem(RELOADED);
  } catch {
    // Storage blocked: reloadedOnce() already reports true, so nothing to record.
  }
}

/**
 * A chunk failed to load, most likely because a new deploy removed it. Fetch the new service
 * worker (it skips waiting and claims the page), wait for it to take control, then reload once.
 * Returns false when the reload was already tried in this tab.
 */
async function reloadForUpdate(): Promise<boolean> {
  if (reloadedOnce()) return false;
  const sw = "serviceWorker" in navigator ? navigator.serviceWorker : null;
  const reg = await sw?.getRegistration();
  if (sw && reg) {
    await reg.update();
    if (reg.installing ?? reg.waiting) {
      await new Promise<void>((done) => {
        sw.addEventListener("controllerchange", () => done(), { once: true });
        setTimeout(done, 5000);
      });
    }
  }
  setReloaded(true);
  location.reload();
  return true;
}

function Lazy<P extends object>({
  load,
  props,
}: {
  load: () => Promise<ComponentType<P>>;
  props: P;
}) {
  const [Screen, setScreen] = useState<ComponentType<P> | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const fail = (err: unknown) =>
      live && setFailed(err instanceof Error ? err.message : String(err));
    load().then(
      (c) => {
        setReloaded(false);
        if (live) setScreen(() => c);
      },
      (err: unknown) =>
        reloadForUpdate().then(
          (reloading) => reloading || fail(err),
          () => fail(err),
        ),
    );
    return () => {
      live = false;
    };
  }, [load]);
  if (failed) {
    return (
      <div class="sb-notice sb-notice--error" role="alert">
        <p class="sb-notice__body">This screen could not load ({failed}).</p>
        <button
          type="button"
          class="sb-button"
          onClick={() => {
            setReloaded(false);
            location.reload();
          }}
        >
          Reload
        </button>
      </div>
    );
  }
  if (!Screen) {
    return (
      <p class="sb-notice" role="status">
        Loading…
      </p>
    );
  }
  return <Screen {...props} />;
}

function Screen({ current }: { current: Route }) {
  switch (current.kind) {
    case "home":
      return <Compose />;
    case "not-found":
      return <NotFound />;
    case "link":
    case "nostr":
      return <Lazy<{ route: ViewRoute }> load={loadView} props={{ route: current }} />;
    case "delete":
      return <Lazy<{ route: DeleteRoute }> load={loadDelete} props={{ route: current }} />;
  }
}

export function App() {
  const current = route.value;
  return (
    <div class="sb-app">
      <header class="sb-header">
        <a class="sb-header__brand" href="#/">
          sealbin
        </a>
        <div class="sb-header__spacer" />
        <div class="sb-header__actions">
          <ThemePicker />
          <Shortcuts />
        </div>
      </header>
      <main class="sb-main">
        <Screen key={`${routeKey(current)}|${visit.value}`} current={current} />
      </main>
      <ToastRegion />
    </div>
  );
}
