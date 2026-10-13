/**
 * Transient feedback ("Link copied", failures). Call `toast()` from anywhere; `<ToastRegion />`
 * is mounted once by App. Errors use role="alert" so screen readers announce them at once.
 */
import { signal } from "@preact/signals";

export type ToastKind = "info" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const toasts = signal<ToastItem[]>([]);
let nextId = 1;

export function toast(
  message: string,
  kind: ToastKind = "info",
  ms = kind === "error" ? 6000 : 2500,
) {
  const id = nextId++;
  toasts.value = [...toasts.value, { id, kind, message }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, ms);
}

export function ToastRegion() {
  return (
    <div class="sb-toast-region">
      <div role="status" aria-live="polite">
        {toasts.value
          .filter((t) => t.kind === "info")
          .map((t) => (
            <div key={t.id} class="sb-toast">
              {t.message}
            </div>
          ))}
      </div>
      <div role="alert">
        {toasts.value
          .filter((t) => t.kind === "error")
          .map((t) => (
            <div key={t.id} class="sb-toast sb-toast--error">
              {t.message}
            </div>
          ))}
      </div>
    </div>
  );
}
