/**
 * Burn-after-reading interstitial. The paste is already fetched and decrypted, but nothing is
 * shown, and nothing is destroyed, until the reader chooses to reveal it: link previews and
 * scanners that open the URL do not burn it.
 */
export function Burn({ onReveal }: { onReveal: () => void }) {
  return (
    <section class="sb-interstitial sb-interstitial--warning" aria-labelledby="sb-burn-title">
      <h1 id="sb-burn-title" class="sb-interstitial__title">
        This paste will be destroyed after you open it
      </h1>
      <p class="sb-interstitial__body">
        It is burned after reading: once revealed, it is deleted from the relays and this link stops
        working. Copy or download it before you leave the page.
      </p>
      <div class="sb-interstitial__actions">
        <button type="button" class="sb-button sb-button--primary" onClick={onReveal}>
          Reveal and destroy
        </button>
      </div>
    </section>
  );
}
