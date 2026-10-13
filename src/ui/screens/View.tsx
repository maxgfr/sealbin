/**
 * Paste viewer for `#/l/…`, `#/p/…` (link mode, decrypted locally with no network request) and
 * `#/n/…` (fetched from Nostr relays). The core modules are imported on demand.
 *
 * Flow: load → (password prompt) → (burn interstitial) → paste. A burn paste is fetched and
 * decrypted but shown only after "Reveal"; then it is burned on the relays and the secret is
 * dropped from the URL, while the plaintext stays on screen.
 */
import { useEffect, useState } from "preact/hooks";
import type { Paste } from "../../core/codec";
import { PasswordRequiredError, WrongPasswordError } from "../../core/errors";
import { type LineRange, type Route, serializeRoute } from "../../core/link";
import { CodeView } from "../components/CodeView";
import { Markdown } from "../components/Markdown";
import { QrDialog } from "../components/QrDialog";
import { useShortcutActions } from "../components/Shortcuts";
import { toast } from "../components/Toast";
import { Toolbar } from "../components/Toolbar";
import { downloadName, openRaw, saveText } from "../lib/download";
import { composeDraft } from "../lib/draft";
import { describeError } from "../lib/errors";
import { formatTimeLeft } from "../lib/expiry";
import { fitsQr } from "../lib/size";
import { dropFragment, navigate, routeUrl } from "../routes";
import { Burn } from "./Burn";
import { ErrorState } from "./ErrorState";
import { Unlock } from "./Unlock";

type ViewRoute = Extract<Route, { kind: "link" | "nostr" }>;

interface Loaded {
  paste: Paste;
  /** Short links only: what burnPaste needs. */
  event?: { id: string; createdAt: number };
}

type State =
  | { s: "loading" }
  | { s: "password"; error: string | null; busy: boolean }
  | { s: "burn"; loaded: Loaded }
  | { s: "ready"; loaded: Loaded; burned: boolean }
  | { s: "error"; error: unknown };

async function load(r: ViewRoute, password: string | undefined): Promise<Loaded> {
  const opts = password === undefined ? {} : { password };
  if (r.kind === "link") {
    const { decodeLinkPayload } = await import("../../core/codec");
    return { paste: await decodeLinkPayload(r.payload, opts) };
  }
  const { fetchPaste } = await import("../../core/nostr");
  const res = await fetchPaste(r.secret, opts);
  return { paste: res.paste, event: { id: res.eventId, createdAt: res.createdAt } };
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch (err) {
    toast(`Could not copy: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

export function View({ route }: { route: ViewRoute }) {
  const [state, setState] = useState<State>(
    route.kind === "link" && route.password
      ? { s: "password", error: null, busy: false }
      : { s: "loading" },
  );
  const [attempt, setAttempt] = useState(0);

  async function open(password?: string) {
    try {
      const loaded = await load(route, password);
      setState(
        loaded.paste.burn && route.kind === "nostr"
          ? { s: "burn", loaded }
          : { s: "ready", loaded, burned: false },
      );
    } catch (err) {
      if (err instanceof PasswordRequiredError) {
        setState({ s: "password", error: null, busy: false });
      } else if (err instanceof WrongPasswordError) {
        setState({ s: "password", error: describeError(err).body, busy: false });
      } else {
        setState({ s: "error", error: err });
      }
    }
  }

  // Runs on mount, and again for each "Try again" (`attempt`).
  useEffect(() => {
    if (state.s === "loading") void open();
  }, [attempt]);

  function reveal(loaded: Loaded) {
    setState({ s: "ready", loaded, burned: true });
    dropFragment();
    if (route.kind !== "nostr" || !loaded.event) return;
    const { secret } = route;
    const { id, createdAt } = loaded.event;
    import("../../core/nostr")
      .then(({ burnPaste }) => burnPaste(secret, id, { createdAt }))
      .then(
        () => toast("Destroyed on the relays. The link no longer works."),
        (err: unknown) =>
          toast(
            `${describeError(err).title}: the paste may stay readable until it expires.`,
            "error",
          ),
      );
  }

  switch (state.s) {
    case "loading":
      return (
        <p class="sb-notice" role="status">
          {route.kind === "nostr" ? "Fetching from relays…" : "Decrypting…"}
        </p>
      );
    case "password":
      return (
        <Unlock
          error={state.error}
          busy={state.busy}
          onSubmit={(pw) => {
            setState({ s: "password", error: null, busy: true });
            void open(pw);
          }}
        />
      );
    case "burn":
      return <Burn onReveal={() => reveal(state.loaded)} />;
    case "error":
      return (
        <ErrorState
          error={state.error}
          onRetry={() => {
            setState({ s: "loading" });
            setAttempt((n) => n + 1);
          }}
          onPassword={() => setState({ s: "password", error: null, busy: false })}
        />
      );
    case "ready":
      return <PasteView route={route} paste={state.loaded.paste} burned={state.burned} />;
  }
}

function PasteView({ route, paste, burned }: { route: ViewRoute; paste: Paste; burned: boolean }) {
  const [wrap, setWrap] = useState(false);
  const isMarkdown = paste.lang === "markdown";
  const [rendered, setRendered] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const shareUrl = burned ? null : routeUrl(route, location);
  const canQr = shareUrl !== null && fitsQr(shareUrl);

  const actions = {
    wrap: () => setWrap((w) => !w),
    markdown: () => {
      if (isMarkdown) setRendered((r) => !r);
    },
    copyContent: () => void copy(paste.content, "Content"),
    copyLink: () => {
      if (shareUrl) void copy(shareUrl, "Link");
    },
    qr: () => {
      if (canQr) setQrOpen(true);
    },
    raw: () => openRaw(paste.content),
    download: () => saveText(paste.content, downloadName(paste)),
    fork: () => {
      composeDraft.value = {
        title: paste.title,
        filename: paste.filename,
        lang: paste.lang,
        content: paste.content,
      };
      navigate({ kind: "home" });
    },
  };
  useShortcutActions(actions);

  const selectLines = (lines: LineRange) => navigate({ ...route, lines });
  const heading = paste.title || paste.filename || "Untitled paste";

  return (
    <section class="sb-view" aria-labelledby="sb-view-title">
      <div class="sb-view__head">
        <h1 id="sb-view-title" class="sb-toolbar__title">
          {heading}
        </h1>
        <div class="sb-view__badges">
          {paste.filename && paste.title && <span class="sb-badge">{paste.filename}</span>}
          <span class="sb-badge sb-badge--seal">Encrypted</span>
          {burned ? (
            <span class="sb-badge sb-badge--warning">Burned after reading</span>
          ) : paste.expiresAt !== null ? (
            <span class="sb-badge sb-badge--warning" title={new Date(paste.expiresAt).toString()}>
              Expires in {formatTimeLeft(paste.expiresAt)}
              {route.kind === "link" && " · checked by your browser only"}
            </span>
          ) : (
            <span class="sb-badge">Never expires</span>
          )}
        </div>
      </div>
      {burned && (
        <p class="sb-notice sb-notice--warning" role="status">
          This paste is destroyed and its link no longer works. Copy or download it now: it is gone
          once you leave this page.
        </p>
      )}
      <Toolbar
        wrap={wrap}
        onWrap={actions.wrap}
        markdown={isMarkdown ? { on: rendered, toggle: actions.markdown } : undefined}
        onCopyContent={actions.copyContent}
        onCopyLink={shareUrl ? actions.copyLink : undefined}
        onQr={canQr ? actions.qr : undefined}
        onRaw={actions.raw}
        onDownload={actions.download}
        onFork={actions.fork}
      />
      {isMarkdown && rendered ? (
        <Markdown content={paste.content} />
      ) : (
        <CodeView
          content={paste.content}
          lang={paste.lang}
          wrap={wrap}
          lines={route.lines}
          lineHref={burned ? undefined : (lines) => serializeRoute({ ...route, lines })}
          onSelectLines={burned ? undefined : selectLines}
        />
      )}
      {shareUrl && (
        <QrDialog url={shareUrl} open={qrOpen && canQr} onClose={() => setQrOpen(false)} />
      )}
    </section>
  );
}
