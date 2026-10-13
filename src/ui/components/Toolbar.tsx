/** View toolbar: one button per action, each naming its key (see Shortcuts.tsx). */

export interface ToolbarProps {
  wrap: boolean;
  onWrap: () => void;
  /** Present only for Markdown pastes. */
  markdown?: { on: boolean; toggle: () => void } | undefined;
  onCopyContent: () => void;
  /** Absent once the link no longer works (burned paste). */
  onCopyLink?: (() => void) | undefined;
  onQr?: (() => void) | undefined;
  onRaw: () => void;
  onDownload: () => void;
  onFork: () => void;
}

function Key({ k }: { k: string }) {
  return <kbd class="sb-kbd">{k}</kbd>;
}

export function Toolbar(p: ToolbarProps) {
  return (
    <div class="sb-toolbar" role="toolbar" aria-label="Paste actions">
      <div class="sb-toolbar__group">
        {p.markdown && (
          <button
            type="button"
            aria-label="Rendered Markdown"
            class="sb-button"
            aria-pressed={p.markdown.on}
            aria-keyshortcuts="m"
            onClick={p.markdown.toggle}
          >
            Rendered Markdown <Key k="m" />
          </button>
        )}
        <button
          type="button"
          aria-label="Wrap"
          class="sb-button"
          aria-pressed={p.wrap}
          aria-keyshortcuts="w"
          onClick={p.onWrap}
        >
          Wrap <Key k="w" />
        </button>
      </div>
      <div class="sb-toolbar__group">
        <button
          type="button"
          aria-label="Copy content"
          class="sb-button"
          aria-keyshortcuts="c"
          onClick={p.onCopyContent}
        >
          Copy content <Key k="c" />
        </button>
        {p.onCopyLink && (
          <button
            type="button"
            aria-label="Copy link"
            class="sb-button"
            aria-keyshortcuts="y"
            onClick={p.onCopyLink}
          >
            Copy link <Key k="y" />
          </button>
        )}
        {p.onQr && (
          <button
            type="button"
            aria-label="QR code"
            class="sb-button"
            aria-keyshortcuts="q"
            aria-haspopup="dialog"
            onClick={p.onQr}
          >
            QR code <Key k="q" />
          </button>
        )}
        <button
          type="button"
          aria-label="Raw"
          class="sb-button"
          aria-keyshortcuts="r"
          onClick={p.onRaw}
        >
          Raw <Key k="r" />
        </button>
        <button
          type="button"
          aria-label="Download"
          class="sb-button"
          aria-keyshortcuts="d"
          onClick={p.onDownload}
        >
          Download <Key k="d" />
        </button>
        <button
          type="button"
          aria-label="Fork"
          class="sb-button"
          aria-keyshortcuts="f"
          onClick={p.onFork}
        >
          Fork <Key k="f" />
        </button>
      </div>
    </div>
  );
}
