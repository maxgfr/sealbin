/**
 * QR code for a share link, in a native <dialog>. uqr is loaded on demand; the SVG is built as
 * elements (one path of dark modules), never from markup. Links over 2,953 bytes get no QR code.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { fitsQr } from "../lib/size";

/** Quiet zone around the code, in modules (the QR spec asks for 4). */
const MARGIN = 4;

/** One SVG path drawing every dark module as a 1×1 square. */
function modulesPath(data: boolean[][]): string {
  const parts: string[] = [];
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + MARGIN} ${y + MARGIN}h1v1h-1z`);
    });
  });
  return parts.join("");
}

export function QrDialog({
  url,
  open,
  onClose,
}: {
  url: string;
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [qr, setQr] = useState<{ size: number; path: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const fits = fitsQr(url);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!open || !fits) return;
    let live = true;
    import("uqr").then(
      ({ encode }) => {
        if (!live) return;
        const { size, data } = encode(url, { ecc: "L" });
        setQr({ size, path: modulesPath(data) });
      },
      (err: unknown) => live && setFailed(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
  }, [open, url, fits]);

  const side = qr ? qr.size + 2 * MARGIN : 0;
  return (
    <dialog ref={dialog} class="sb-dialog" aria-labelledby="sb-qr-title" onClose={onClose}>
      <h2 id="sb-qr-title" class="sb-dialog__title">
        QR code
      </h2>
      {!fits ? (
        <p class="sb-notice sb-notice--warning">
          This link is too long for a QR code (over 2,953 bytes). Share it as text, or use a short
          link.
        </p>
      ) : failed ? (
        <p class="sb-notice sb-notice--error" role="alert">
          The QR code could not be drawn ({failed}).
        </p>
      ) : qr ? (
        <svg
          class="sb-qr"
          viewBox={`0 0 ${side} ${side}`}
          role="img"
          aria-label="QR code of the link"
          shape-rendering="crispEdges"
        >
          <rect width={side} height={side} fill="#fff" />
          <path d={qr.path} fill="#000" />
        </svg>
      ) : (
        <p class="sb-notice" role="status">
          Drawing…
        </p>
      )}
      <p class="sb-field__hint">Anyone who scans it can read the paste.</p>
      <div class="sb-dialog__actions">
        <button type="button" class="sb-button" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
