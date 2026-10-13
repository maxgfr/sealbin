/**
 * CodeMirror 6 host. Controlled loosely: `value` replaces the document only when `revision` changes
 * (draft prefill, opened file, reset). Typing never round-trips: effects run after paint with the
 * `value` of their render, which lags behind fast typing, so syncing on `value` itself would write
 * stale text back and ping-pong forever.
 * Text that uses CRLF line breaks keeps them: the line separator follows the text set from outside,
 * so an opened Windows file round-trips byte for byte.
 * `lang` is a Shiki id; the matching CodeMirror mode is looked up lazily in
 * `@codemirror/language-data` (each mode is its own chunk).
 */
import { LanguageDescription } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "preact/hooks";
import { toast } from "./Toast";

interface EditorProps {
  value: string;
  /** Bumped by the parent each time it replaces the text; typing never bumps it. */
  revision: number;
  onChange: (value: string) => void;
  lang: string;
  label: string;
  /** Called with a file dropped onto the editor (instead of CodeMirror inserting it). */
  onFile?: (file: File) => void;
}

/** Shiki ids whose CodeMirror name differs. */
/** CodeMirror's line separator for `text`: CRLF when the text uses it, else the default (LF). */
export function lineSeparatorFor(text: string) {
  return text.includes("\r\n") ? EditorState.lineSeparator.of("\r\n") : [];
}

const CM_NAMES: Record<string, string> = { shellscript: "shell", docker: "dockerfile" };

export function Editor({ value, revision, onChange, lang, label, onFile }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const separator = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          EditorView.lineWrapping,
          language.current.of([]),
          separator.current.of(lineSeparatorFor(value)),
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.sliceDoc());
          }),
          EditorView.domEventHandlers({
            dragover: (e) => {
              if (!e.dataTransfer?.types.includes("Files")) return false;
              e.preventDefault();
              host.current?.classList.add("sb-editor--dragover");
              return true;
            },
            dragleave: () => {
              host.current?.classList.remove("sb-editor--dragover");
              return false;
            },
            drop: (e) => {
              host.current?.classList.remove("sb-editor--dragover");
              const file = e.dataTransfer?.files[0];
              if (!file || !onFileRef.current) return false;
              e.preventDefault();
              onFileRef.current(file);
              return true;
            },
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // Created once; later prop changes are applied by the effects below.
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.sliceDoc() !== value) {
      // Separator first: the inserted text is split into lines by the new state's separator.
      v.dispatch({ effects: separator.current.reconfigure(lineSeparatorFor(value)) });
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [revision]);

  useEffect(() => {
    let live = true;
    const apply = (ext: Parameters<Compartment["reconfigure"]>[0]) =>
      view.current?.dispatch({ effects: language.current.reconfigure(ext) });
    if (!lang) {
      apply([]);
      return;
    }
    import("@codemirror/language-data")
      .then(async ({ languages }) => {
        const desc = LanguageDescription.matchLanguageName(languages, CM_NAMES[lang] ?? lang, true);
        const support = desc ? await desc.load() : [];
        if (live) apply(support);
      })
      .catch((err: unknown) => {
        // Editor highlighting is cosmetic: keep plain text and say so.
        if (!live) return;
        apply([]);
        toast(
          `Editor highlighting unavailable: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      });
    return () => {
      live = false;
    };
  }, [lang]);

  return <div ref={host} class="sb-editor" />;
}
