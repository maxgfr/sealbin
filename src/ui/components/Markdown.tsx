/**
 * Rendered Markdown (marked + DOMPurify, both loaded on demand). The sanitised HTML is the only
 * markup this component injects. Media and embeds are dropped so that rendering a paste never
 * makes a network request. Raw HTML in the paste is escaped by marked, so it never reaches an
 * HTML parser (an inline handler would otherwise trip the CSP). Headings get "md-" ids and
 * "#…" links scroll to them without touching the URL (the hash is the router's); other links
 * open in a new tab with rel="noopener noreferrer".
 */
import { useEffect, useRef, useState } from "preact/hooks";

const FORBID_TAGS = [
  "img",
  "picture",
  "source",
  "video",
  "audio",
  "track",
  "iframe",
  "frame",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "style",
  "link",
  "meta",
  "base",
  "svg",
  "math",
];

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/** GitHub-style anchor for a heading text: "Usage & notes" → "usage--notes". */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Gives each heading under `root` a unique "md-<slug>" id. */
function anchorHeadings(root: HTMLElement) {
  const seen = new Map<string, number>();
  for (const h of root.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const slug = slugify(h.textContent ?? "");
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    h.id = `md-${n ? `${slug}-${n}` : slug}`;
  }
}

/** In-page links scroll to their heading instead of changing the hash. */
function onLinkClick(e: MouseEvent) {
  const a = e.target instanceof Element ? e.target.closest("a") : null;
  const href = a?.getAttribute("href");
  if (!href?.startsWith("#")) return;
  e.preventDefault();
  let target: string;
  try {
    target = decodeURIComponent(href.slice(1));
  } catch {
    target = href.slice(1);
  }
  document.getElementById(`md-${slugify(target)}`)?.scrollIntoView({ block: "start" });
}

let renderer: Promise<(md: string) => string> | undefined;

function loadRenderer(): Promise<(md: string) => string> {
  renderer ??= Promise.all([import("marked"), import("dompurify")]).then(
    ([{ Marked }, { default: DOMPurify }]) => {
      const marked = new Marked({
        gfm: true,
        async: false,
        renderer: { html: ({ text }) => escapeHtml(text) },
      });
      DOMPurify.addHook("afterSanitizeAttributes", (node) => {
        if (!(node instanceof HTMLAnchorElement)) return;
        node.rel = "noopener noreferrer";
        if (!node.getAttribute("href")?.startsWith("#")) node.target = "_blank";
      });
      return (md: string) =>
        DOMPurify.sanitize(marked.parse(md, { async: false }), {
          FORBID_TAGS,
          FORBID_ATTR: ["style", "srcset", "background", "poster"],
        });
    },
  );
  return renderer;
}

export function Markdown({ content }: { content: string }) {
  const el = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  // A native listener: clicks on links come from mouse and keyboard alike.
  useEffect(() => {
    const node = el.current;
    node?.addEventListener("click", onLinkClick);
    return () => node?.removeEventListener("click", onLinkClick);
  }, []);

  useEffect(() => {
    let live = true;
    setState("loading");
    loadRenderer().then(
      (render) => {
        if (!live || !el.current) return;
        el.current.innerHTML = render(content);
        anchorHeadings(el.current);
        setState("ready");
      },
      (err: unknown) => {
        console.warn("sealbin: Markdown rendering failed", err);
        if (live) setState("failed");
      },
    );
    return () => {
      live = false;
    };
  }, [content]);

  return (
    <>
      {state === "loading" && (
        <p class="sb-notice" role="status">
          Rendering…
        </p>
      )}
      {state === "failed" && (
        <p class="sb-notice sb-notice--error" role="alert">
          Markdown could not be rendered. Switch back to the source view.
        </p>
      )}
      <article ref={el} class="sb-markdown" aria-label="Rendered Markdown" />
    </>
  );
}
