/**
 * Read-only code with line numbers. Shiki tokens are rendered as elements (no markup strings);
 * until they arrive, or for plain text and pastes over the highlight limits, the lines are plain.
 * Line numbers link to `#…&L5`; shift-click extends the selection to a range.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type { LineRange } from "../../core/link";
import {
  codeThemeDefinition,
  HIGHLIGHT_MAX_BYTES,
  HIGHLIGHT_MAX_LINES,
  type HighlightResult,
  highlight,
  highlightLimit,
  splitLines,
} from "../lib/highlight";
import { codeTheme, themePref } from "../lib/theme";

interface Token {
  content: string;
  /** Offset in the source: unique within a line. */
  offset: number;
  color?: string | undefined;
  fontStyle?: number | undefined;
}

/** Shiki FontStyle bits. */
const ITALIC = 1;
const BOLD = 2;
const UNDERLINE = 4;

function tokenStyle(t: Token) {
  if (!t.color && !t.fontStyle) return undefined;
  const fs = t.fontStyle ?? 0;
  return {
    color: t.color,
    fontStyle: fs & ITALIC ? "italic" : undefined,
    fontWeight: fs & BOLD ? "bold" : undefined,
    textDecoration: fs & UNDERLINE ? "underline" : undefined,
  };
}

export interface CodeViewProps {
  content: string;
  /** Shiki language id; "" = plain text. */
  lang: string;
  wrap: boolean;
  lines?: LineRange | undefined;
  /** URL of a line range; without it, line numbers are not links (e.g. a burned paste). */
  lineHref?: ((range: LineRange) => string) | undefined;
  onSelectLines?: ((range: LineRange) => void) | undefined;
}

export function CodeView({ content, lang, wrap, lines, lineHref, onSelectLines }: CodeViewProps) {
  const theme = codeTheme.value;
  const themed = themePref.value.code !== "auto";
  const limit = highlightLimit(content);
  // Tagged with what it highlights, so a theme change keeps it on screen until the new one is
  // ready (no flash to plain text) while new content or a new language never shows a stale one.
  const [highlighted, setHighlighted] = useState<{
    content: string;
    lang: string;
    result: HighlightResult | null;
  } | null>(null);
  const result =
    highlighted && highlighted.content === content && highlighted.lang === lang && !limit
      ? highlighted.result
      : null;
  // A chosen theme's background and foreground, for text shown plain (no language, over the
  // limits): the highlighted result carries its own.
  const [surface, setSurface] = useState<{ fg: string; bg: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLElement>(null);
  const scrolled = useRef(false);

  useEffect(() => {
    setFailed(false);
    if (!lang || limit) return;
    let live = true;
    highlight(content, lang, theme).then(
      (r) => live && setHighlighted({ content, lang, result: r }),
      (err: unknown) => {
        console.warn("sealbin: highlighting failed, showing plain text", err);
        if (!live) return;
        setHighlighted(null);
        setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [content, lang, theme, limit]);

  useEffect(() => {
    if (!themed) return;
    let live = true;
    codeThemeDefinition(theme).then(
      ({ fg, bg }) => {
        if (live) setSurface({ fg, bg });
      },
      (err: unknown) => {
        console.warn("sealbin: code theme unavailable, keeping the page colours", err);
      },
    );
    return () => {
      live = false;
    };
  }, [theme, themed]);

  const plain = splitLines(content);
  let rows: Token[][] = plain.map((text) => (text ? [{ content: text, offset: 0 }] : []));
  if (result) {
    rows = result.lines;
    // Shiki keeps the empty line after a trailing newline; the plain split does not.
    if (rows.length > plain.length) rows = rows.slice(0, plain.length);
  }

  useEffect(() => {
    if (scrolled.current || !lines) return;
    const el = root.current?.querySelector(`#L${lines.start}`);
    if (el) {
      scrolled.current = true;
      el.scrollIntoView({ block: "center" });
    }
  }, [lines, rows.length]);

  const colors = result ?? surface;
  const style = themed && colors ? { background: colors.bg, color: colors.fg } : undefined;
  return (
    <>
      {limit && (
        <p class="sb-notice">
          Highlighting is off for pastes over{" "}
          {limit === "bytes"
            ? `${HIGHLIGHT_MAX_BYTES / 1024} KB`
            : `${HIGHLIGHT_MAX_LINES.toLocaleString("en")} lines`}
          : shown as plain text.
        </p>
      )}
      {failed && <p class="sb-notice">Highlighting is unavailable: shown as plain text.</p>}
      <section
        ref={root}
        class={wrap ? "sb-code sb-code--wrap" : "sb-code"}
        style={style}
        data-state={result ? "highlighted" : "plain"}
        aria-label="Paste content"
      >
        <pre>
          <code>
            {rows.map((tokens, i) => {
              const n = i + 1;
              const on = lines !== undefined && n >= lines.start && n <= lines.end;
              return (
                <span
                  key={n}
                  id={`L${n}`}
                  class={on ? "sb-code__line is-highlighted" : "sb-code__line"}
                >
                  {lineHref ? (
                    <a
                      class="sb-code__number"
                      href={lineHref({ start: n, end: n })}
                      aria-label={`Line ${n}`}
                      onClick={(e) => {
                        if (!onSelectLines || e.metaKey || e.ctrlKey || e.button !== 0) return;
                        e.preventDefault();
                        onSelectLines(
                          e.shiftKey && lines
                            ? { start: Math.min(lines.start, n), end: Math.max(lines.start, n) }
                            : { start: n, end: n },
                        );
                      }}
                    >
                      {n}
                    </a>
                  ) : (
                    <span class="sb-code__number" aria-hidden="true">
                      {n}
                    </span>
                  )}
                  <span class="sb-code__content">
                    {tokens.map((t) => (
                      <span key={t.offset} style={tokenStyle(t)}>
                        {t.content}
                      </span>
                    ))}
                  </span>
                </span>
              );
            })}
          </code>
        </pre>
      </section>
    </>
  );
}
