/** Password prompt for `#/p/…` links and password-protected short links. */
import { useEffect, useRef, useState } from "preact/hooks";

export function Unlock({
  error,
  busy,
  onSubmit,
}: {
  /** Inline message after a wrong password. */
  error: string | null;
  busy: boolean;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) input.current?.focus();
  }, [busy, error]);

  return (
    <section class="sb-interstitial" aria-labelledby="sb-unlock-title">
      <h1 id="sb-unlock-title" class="sb-interstitial__title">
        This paste is password-protected
      </h1>
      <p class="sb-interstitial__body">
        Enter the password the sender gave you. It never leaves this browser.
      </p>
      <form
        class="sb-unlock"
        onSubmit={(e) => {
          e.preventDefault();
          if (password && !busy) onSubmit(password);
        }}
      >
        <div class="sb-field">
          <label class="sb-field__label" for="sb-unlock-password">
            Password
          </label>
          <input
            ref={input}
            id="sb-unlock-password"
            class="sb-input"
            type="password"
            autoComplete="off"
            value={password}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "sb-unlock-error" : undefined}
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
          {error && (
            <span id="sb-unlock-error" class="sb-field__error" role="alert">
              {error}
            </span>
          )}
        </div>
        <div class="sb-interstitial__actions">
          <button
            type="submit"
            class="sb-button sb-button--primary"
            disabled={busy || password === ""}
          >
            {busy ? "Unlocking…" : "Unlock"}
          </button>
        </div>
      </form>
    </section>
  );
}
