/**
 * App shell: header, routed screen, toast region.
 *
 * Header: brand, a spacer, then `.sb-header__actions` (theme picker, keyboard shortcuts help).
 * Screens: Compose and NotFound are in the entry chunk; View (link/nostr routes) and Delete
 * are loaded on demand from `./screens/View` and `./screens/Delete`, each receiving `{ route }`.
 * A screen remounts whenever the route changes (keyed by the serialized route, minus `&L` lines).
 */
import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Route } from "../core/link";
import { Shortcuts } from "./components/Shortcuts";
import { ThemePicker } from "./components/ThemePicker";
import { ToastRegion } from "./components/Toast";
import { route, routeKey } from "./routes";
import { Compose } from "./screens/Compose";
import { NotFound } from "./screens/NotFound";

type ViewRoute = Extract<Route, { kind: "link" | "nostr" }>;
type DeleteRoute = Extract<Route, { kind: "delete" }>;

const loadView = () => import("./screens/View").then((m) => m.View);
const loadDelete = () => import("./screens/Delete").then((m) => m.Delete);

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
    load().then(
      (c) => live && setScreen(() => c),
      (err: unknown) => live && setFailed(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
  }, [load]);
  if (failed) {
    return (
      <p class="sb-notice sb-notice--error" role="alert">
        This screen could not load ({failed}). Reload the page to try again.
      </p>
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
        <Screen key={routeKey(current)} current={current} />
      </main>
      <ToastRegion />
    </div>
  );
}
