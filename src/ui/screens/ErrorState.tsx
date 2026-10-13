/** Full-screen error for a paste that cannot be shown: copy from lib/errors.ts. */
import { describeError } from "../lib/errors";
import { navigate } from "../routes";

export function ErrorState({
  error,
  onRetry,
  onPassword,
}: {
  error: unknown;
  onRetry?: () => void;
  onPassword?: () => void;
}) {
  const { title, body, action } = describeError(error);
  const handler =
    action.kind === "retry" ? onRetry : action.kind === "password" ? onPassword : undefined;
  return (
    <section
      class="sb-interstitial sb-interstitial--error"
      role="alert"
      aria-labelledby="sb-error-title"
    >
      <h1 id="sb-error-title" class="sb-interstitial__title">
        {title}
      </h1>
      <p class="sb-interstitial__body">{body}</p>
      <div class="sb-interstitial__actions">
        {handler ? (
          <button type="button" class="sb-button sb-button--primary" onClick={handler}>
            {action.label}
          </button>
        ) : null}
        {action.kind === "home" || !handler ? (
          <button
            type="button"
            class={handler ? "sb-button" : "sb-button sb-button--primary"}
            onClick={() => navigate({ kind: "home" })}
          >
            New paste
          </button>
        ) : null}
      </div>
    </section>
  );
}
