/**
 * Keyboard shortcuts and the `?` help dialog. The table below is the single source for both.
 * Screens register what a key does with `useShortcutActions`; a key with no action does nothing.
 * Single keys are ignored while typing (inputs, selects, contenteditable, the CodeMirror editor)
 * and while a dialog is open; `$mod+S` (Create) works everywhere.
 */
import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { defaultKeybindingsHandlerIgnore, tinykeys } from "tinykeys";
import { navigate } from "../routes";

export type ActionId =
  | "raw"
  | "copyLink"
  | "copyContent"
  | "download"
  | "fork"
  | "qr"
  | "markdown"
  | "wrap"
  | "create";

export const SHORTCUTS: readonly { keys: string; label: string; display: string }[] = [
  { keys: "n", display: "n", label: "New paste" },
  { keys: "r", display: "r", label: "Raw text" },
  { keys: "y", display: "y", label: "Copy link" },
  { keys: "c", display: "c", label: "Copy content" },
  { keys: "d", display: "d", label: "Download" },
  { keys: "f", display: "f", label: "Fork into a new paste" },
  { keys: "q", display: "q", label: "QR code" },
  { keys: "m", display: "m", label: "Rendered Markdown" },
  { keys: "w", display: "w", label: "Wrap lines" },
  { keys: "?", display: "?", label: "Keyboard shortcuts" },
  { keys: "$mod+s", display: "Ctrl S / ⌘ S", label: "Create paste" },
];

const KEY_ACTIONS: Record<string, ActionId> = {
  r: "raw",
  y: "copyLink",
  c: "copyContent",
  d: "download",
  f: "fork",
  q: "qr",
  m: "markdown",
  w: "wrap",
};

type ActionMap = Partial<Record<ActionId, () => void>>;

const actions = signal<ActionMap>({});
const helpOpen = signal(false);

/**
 * Bind actions for as long as the calling component is mounted. The set of keys is fixed at
 * mount; the handlers are read on each press, so they always see the latest state.
 */
export function useShortcutActions(map: ActionMap): void {
  const latest = useRef(map);
  latest.current = map;
  useEffect(() => {
    const ids = Object.keys(latest.current) as ActionId[];
    const bound: ActionMap = {};
    for (const id of ids) bound[id] = () => latest.current[id]?.();
    actions.value = { ...actions.value, ...bound };
    return () => {
      const next = { ...actions.value };
      for (const id of ids) if (next[id] === bound[id]) delete next[id];
      actions.value = next;
    };
  }, []);
}

function run(id: ActionId, e: KeyboardEvent) {
  const action = actions.value[id];
  if (!action) return;
  e.preventDefault();
  action();
}

function ignoreWhileTyping(e: KeyboardEvent): boolean {
  if (defaultKeybindingsHandlerIgnore(e)) return true;
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest(".cm-editor, [contenteditable], input, textarea, select")) return true;
  return document.querySelector("dialog[open]") !== null;
}

export function Shortcuts() {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const single: Record<string, (e: KeyboardEvent) => void> = {
      n: (e) => {
        e.preventDefault();
        navigate({ kind: "home" });
      },
      "[Shift]+?": (e) => {
        e.preventDefault();
        helpOpen.value = true;
      },
    };
    for (const [key, id] of Object.entries(KEY_ACTIONS)) single[key] = (e) => run(id, e);
    const offSingle = tinykeys(window, single, { ignore: ignoreWhileTyping });
    const offMod = tinykeys(window, { "$mod+s": (e) => run("create", e) }, { ignore: () => false });
    return () => {
      offSingle();
      offMod();
    };
  }, []);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (helpOpen.value && !el.open) el.showModal();
    if (!helpOpen.value && el.open) el.close();
  }, [helpOpen.value]);

  return (
    <>
      <button
        type="button"
        class="sb-button sb-button--ghost sb-header__help"
        aria-label="Keyboard shortcuts"
        aria-keyshortcuts="?"
        aria-haspopup="dialog"
        onClick={() => {
          helpOpen.value = true;
        }}
      >
        ?
      </button>
      <dialog
        ref={dialog}
        class="sb-dialog"
        aria-labelledby="sb-shortcuts-title"
        onClose={() => {
          helpOpen.value = false;
        }}
      >
        <h2 id="sb-shortcuts-title" class="sb-dialog__title">
          Keyboard shortcuts
        </h2>
        <dl class="sb-shortcuts">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} class="sb-shortcuts__row">
              <dt>
                <kbd class="sb-kbd">{s.display}</kbd>
              </dt>
              <dd>{s.label}</dd>
            </div>
          ))}
        </dl>
        <p class="sb-field__hint">Single keys are off while you type in a field or the editor.</p>
        <div class="sb-dialog__actions">
          <button
            type="button"
            class="sb-button"
            onClick={() => {
              helpOpen.value = false;
            }}
          >
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
