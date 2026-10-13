/**
 * Compose: write, seal, share.
 * Link mode seals in the browser and puts everything in the URL fragment: no network request.
 * Short link mode publishes the sealed paste to Nostr relays (burn after reading needs it).
 * The crypto (hash-wasm) and Nostr (nostr-tools) modules are imported on demand, never upfront.
 * Prefill: set `composeDraft` (lib/draft.ts) before navigating home. `$mod+S` (Shortcuts) creates.
 */
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { Paste } from "../../core/codec";
import type { Route } from "../../core/link";
import { Editor } from "../components/Editor";
import { QrDialog } from "../components/QrDialog";
import { useShortcutActions } from "../components/Shortcuts";
import { SizeMeter } from "../components/SizeMeter";
import { toast } from "../components/Toast";
import { takeDraft } from "../lib/draft";
import {
  DEFAULT_EXPIRY,
  EXPIRY_OPTIONS,
  type ExpiryId,
  expiresAt,
  isExpiryId,
} from "../lib/expiry";
import { detectLang, type LangInfo, langFromFilename, langLabel, loadLanguages } from "../lib/lang";
import { fitsQr } from "../lib/size";
import { routeUrl } from "../routes";

type Mode = "link" | "nostr";

interface Result {
  shareUrl: string;
  /** Nostr only. Shown once: it is not recoverable afterwards. */
  deleteUrl: string | null;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch (err) {
    toast(`Could not copy: ${errorText(err)}`, "error");
  }
}

async function readTextFile(file: File): Promise<string> {
  const text = await file.text();
  if (text.includes("\u0000")) throw new Error(`${file.name} is not a text file`);
  return text;
}

export function Compose() {
  const content = useSignal("");
  const title = useSignal("");
  const filename = useSignal("");
  /** Explicit choice from the select; "" = automatic (filename, then detection). */
  const chosenLang = useSignal("");
  const expiry = useSignal<ExpiryId>(DEFAULT_EXPIRY);
  const burn = useSignal(false);
  const password = useSignal("");
  const modeChoice = useSignal<Mode>("link");
  const busy = useSignal(false);
  const error = useSignal<string | null>(null);
  const result = useSignal<Result | null>(null);
  const languages = useSignal<LangInfo[]>([]);
  const qrOpen = useSignal(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const mode = useComputed<Mode>(() => (burn.value ? "nostr" : modeChoice.value));
  const filenameLang = useComputed(() => langFromFilename(filename.value, languages.value));
  const editorLang = useComputed(() => chosenLang.value || filenameLang.value || "");

  useEffect(() => {
    const draft = takeDraft();
    if (draft) {
      if (draft.content !== undefined) content.value = draft.content;
      if (draft.title !== undefined) title.value = draft.title;
      if (draft.filename !== undefined) filename.value = draft.filename;
      if (draft.lang !== undefined) chosenLang.value = draft.lang;
    }
    loadLanguages().then(
      (list) => {
        languages.value = list;
      },
      (err: unknown) => toast(`Language list unavailable: ${errorText(err)}`, "error"),
    );
  }, []);

  useSignalEffect(() => {
    // Any edit invalidates a stale error message.
    void content.value;
    error.value = null;
  });

  async function create() {
    if (busy.value || result.value) return;
    if (!content.value.trim()) {
      error.value = "Nothing to seal yet. Write or drop some text first.";
      return;
    }
    busy.value = true;
    error.value = null;
    try {
      let lang = editorLang.value;
      if (!lang && filenameLang.value === null && languages.value.length > 0) {
        lang = await detectLang(content.value, languages.value);
      }
      const { encodeLinkPayload, PASTE_VERSION } = await import("../../core/codec");
      const paste: Paste = {
        v: PASTE_VERSION,
        title: title.value.trim(),
        lang,
        filename: filename.value.trim(),
        expiresAt: expiresAt(expiry.value),
        burn: burn.value,
        content: content.value,
      };
      const pw = password.value ? { password: password.value } : {};
      if (mode.value === "link") {
        const payload = await encodeLinkPayload(paste, pw);
        const share: Route = { kind: "link", payload, password: password.value !== "" };
        result.value = { shareUrl: routeUrl(share, location), deleteUrl: null };
      } else {
        const { publishPaste } = await import("../../core/nostr");
        const r = await publishPaste(paste, pw);
        result.value = {
          shareUrl: routeUrl({ kind: "nostr", secret: r.secret }, location),
          deleteUrl: routeUrl(
            { kind: "delete", nostrId: r.nostrId, ownerKey: r.ownerKey },
            location,
          ),
        };
      }
      password.value = "";
    } catch (err) {
      error.value = `Could not create the paste. ${errorText(err)}`;
    } finally {
      busy.value = false;
    }
  }

  useShortcutActions({
    create: () => void create(),
    qr: () => {
      if (result.value) qrOpen.value = true;
    },
  });

  async function openFile(file: File) {
    try {
      content.value = await readTextFile(file);
      filename.value = file.name;
    } catch (err) {
      toast(`Could not open the file. ${errorText(err)}`, "error");
    }
  }

  function reset() {
    content.value = "";
    title.value = "";
    filename.value = "";
    chosenLang.value = "";
    burn.value = false;
    result.value = null;
  }

  if (result.value) {
    const { shareUrl, deleteUrl } = result.value;
    return (
      <section class="sb-compose" aria-labelledby="sb-result-title">
        <div class="sb-result">
          <h1 id="sb-result-title" class="sb-result__title">
            Paste sealed
          </h1>
          <div class="sb-field">
            <label class="sb-field__label" for="sb-share-url">
              Share link
            </label>
            <div class="sb-result__row">
              <input id="sb-share-url" class="sb-input" readOnly value={shareUrl} />
              <button
                type="button"
                class="sb-button sb-button--primary"
                onClick={() => copy(shareUrl, "Link")}
              >
                Copy link
              </button>
            </div>
            <span class="sb-field__hint">
              {mode.value === "link"
                ? "The key is in the link. Anyone with it can read the paste."
                : "The key is in the link. Relays only store ciphertext."}
            </span>
          </div>
          {deleteUrl && (
            <div class="sb-field">
              <label class="sb-field__label" for="sb-delete-url">
                Delete link
              </label>
              <div class="sb-result__row">
                <input id="sb-delete-url" class="sb-input" readOnly value={deleteUrl} />
                <button
                  type="button"
                  class="sb-button"
                  onClick={() => copy(deleteUrl, "Delete link")}
                >
                  Copy delete link
                </button>
              </div>
              <p class="sb-notice sb-notice--warning">
                Shown once. Keep it to delete the paste before it expires.
              </p>
            </div>
          )}
          <div class="sb-compose__actions">
            <div class="sb-toolbar__group">
              <a class="sb-button" href={shareUrl}>
                Open paste
              </a>
              {fitsQr(shareUrl) && (
                <button
                  type="button"
                  class="sb-button"
                  aria-keyshortcuts="q"
                  onClick={() => {
                    qrOpen.value = true;
                  }}
                >
                  QR code
                </button>
              )}
            </div>
            <button type="button" class="sb-button" onClick={reset}>
              New paste
            </button>
          </div>
        </div>
        <QrDialog
          url={shareUrl}
          open={qrOpen.value && fitsQr(shareUrl)}
          onClose={() => {
            qrOpen.value = false;
          }}
        />
      </section>
    );
  }

  const langs = languages.value;
  return (
    <section class="sb-compose" aria-label="New paste">
      <div class="sb-compose__meta">
        <div class="sb-field">
          <label class="sb-field__label" for="sb-title">
            Title
          </label>
          <input
            id="sb-title"
            class="sb-input"
            value={title.value}
            onInput={(e) => {
              title.value = e.currentTarget.value;
            }}
            placeholder="Optional"
            autoComplete="off"
          />
        </div>
        <div class="sb-field">
          <label class="sb-field__label" for="sb-filename">
            Filename
          </label>
          <input
            id="sb-filename"
            class="sb-input"
            value={filename.value}
            onInput={(e) => {
              filename.value = e.currentTarget.value;
            }}
            placeholder="e.g. main.rs"
            autoComplete="off"
            spellcheck={false}
          />
        </div>
        <div class="sb-field">
          <label class="sb-field__label" for="sb-lang">
            Language
          </label>
          <select
            id="sb-lang"
            class="sb-select"
            value={chosenLang.value}
            onChange={(e) => {
              chosenLang.value = e.currentTarget.value;
            }}
            aria-describedby="sb-lang-hint"
          >
            <option value="">Automatic</option>
            {langs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <span id="sb-lang-hint" class="sb-field__hint">
            {chosenLang.value
              ? "Chosen by hand."
              : filenameLang.value !== null
                ? `${langLabel(filenameLang.value, langs)}, from the filename.`
                : "Detected from the content when you create."}
          </span>
        </div>
      </div>

      <Editor
        value={content.value}
        onChange={(v) => {
          content.value = v;
        }}
        lang={editorLang.value}
        label="Paste content"
        onFile={openFile}
      />

      <div class="sb-compose__options">
        <div class="sb-field">
          <label class="sb-field__label" for="sb-expiry">
            Expires
          </label>
          <select
            id="sb-expiry"
            class="sb-select"
            value={expiry.value}
            onChange={(e) => {
              const v = e.currentTarget.value;
              if (isExpiryId(v)) expiry.value = v;
            }}
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div class="sb-field">
          <label class="sb-field__label" for="sb-password">
            Password
          </label>
          <input
            id="sb-password"
            class="sb-input"
            type="password"
            value={password.value}
            onInput={(e) => {
              password.value = e.currentTarget.value;
            }}
            placeholder="Optional"
            autoComplete="new-password"
          />
        </div>
        <fieldset class="sb-field">
          <legend class="sb-field__label">Share as</legend>
          <div class="sb-segmented">
            <button
              type="button"
              class="sb-segmented__option"
              aria-pressed={mode.value === "link"}
              disabled={burn.value}
              onClick={() => {
                modeChoice.value = "link";
              }}
            >
              Link
            </button>
            <button
              type="button"
              class="sb-segmented__option"
              aria-pressed={mode.value === "nostr"}
              onClick={() => {
                modeChoice.value = "nostr";
              }}
            >
              Short link (Nostr)
            </button>
          </div>
        </fieldset>
        <label class="sb-check">
          <input
            type="checkbox"
            checked={burn.value}
            onChange={(e) => {
              burn.value = e.currentTarget.checked;
            }}
          />
          Burn after reading
        </label>
      </div>

      <p class="sb-field__hint">
        {burn.value
          ? "Burn after reading needs a short link: the first reader deletes it from the relays."
          : mode.value === "link"
            ? "Everything stays in the link. Expiry is checked by the reader's browser."
            : "Stored encrypted on public Nostr relays, which drop it when it expires."}
      </p>

      <SizeMeter
        paste={{
          // PASTE_VERSION; codec.ts stays out of the entry chunk
          v: 1,
          title: title.value.trim(),
          lang: editorLang.value,
          filename: filename.value.trim(),
          expiresAt: expiresAt(expiry.value),
          burn: burn.value,
          content: content.value,
        }}
        password={password.value !== ""}
        mode={mode.value}
      />

      {error.value && (
        <p class="sb-notice sb-notice--error" role="alert">
          {error.value}
        </p>
      )}

      <div class="sb-compose__actions">
        <div class="sb-toolbar__group">
          <input
            ref={fileInput}
            type="file"
            class="sb-visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (file) void openFile(file);
            }}
          />
          <button
            type="button"
            class="sb-button sb-button--ghost"
            onClick={() => fileInput.current?.click()}
          >
            Open file…
          </button>
        </div>
        <button
          type="button"
          class="sb-button sb-button--primary"
          onClick={() => void create()}
          disabled={busy.value}
          aria-keyshortcuts="Control+S Meta+S"
        >
          {busy.value ? "Sealing…" : "Create"} <kbd class="sb-kbd">Ctrl S</kbd>
        </button>
      </div>
    </section>
  );
}
