export function NotFound() {
  return (
    <section class="sb-interstitial" aria-labelledby="sb-notfound-title">
      <h1 id="sb-notfound-title" class="sb-interstitial__title">
        This link doesn't point to a paste
      </h1>
      <p class="sb-interstitial__body">
        It may be cut short or mistyped. Check that you copied the whole link.
      </p>
      <div class="sb-interstitial__actions">
        <a class="sb-button sb-button--primary" href="#/">
          New paste
        </a>
      </div>
    </section>
  );
}
