/**
 * Registers the service worker (offline shell, link mode offline). Replaces vite-plugin-pwa's
 * injected registerSW.js, which left the promise unhandled: Firefox rejects `register()` with an
 * AbortError when the page reloads while the worker is still installing (precaching over a slow
 * network), and that surfaced as an uncaught page error. The next load registers again, so that
 * case is dropped on purpose; any other failure still propagates.
 */
export async function registerServiceWorker(
  container: { register: (url: string, opts?: RegistrationOptions) => Promise<unknown> },
  base: string,
): Promise<void> {
  try {
    await container.register(`${base}sw.js`, { scope: base });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    throw err;
  }
}
