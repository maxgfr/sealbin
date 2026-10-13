/**
 * Rendered Markdown (marked + DOMPurify, both loaded on demand). The sanitised HTML is the only
 * markup this component injects. Media and embeds are dropped so that rendering a paste never
 * makes a network request; links get rel="noopener noreferrer".
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

let renderer: Promise<(md: string) => string> | undefined;

function loadRenderer(): Promise<(md: string) => string> {
  renderer ??= Promise.all([import("marked"), import("dompurify")]).then(
    ([{ Marked }, { default: DOMPurify }]) => {
      const marked = new Marked({ gfm: true, async: false });
      DOMPurify.addHook("afterSanitizeAttributes", (node) => {
        if (node instanceof HTMLAnchorElement) node.rel = "noopener noreferrer";
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

  useEffect(() => {
    let live = true;
    setState("loading");
    loadRenderer().then(
      (render) => {
        if (!live || !el.current) return;
        el.current.innerHTML = render(content);
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
