# Security

sealbin is a static site. Pastes are compressed and encrypted (AES-256-GCM, key derived with HKDF-SHA-256) in the browser before they leave it. This document describes what that protects and what it does not.

## Trust model

- **The served JavaScript is the trust anchor.** Whoever controls the code served from `maxgfr.github.io/sealbin/` (the GitHub account, GitHub Pages, or anyone able to tamper with the deployment) can ship code that reads your secrets. Encryption protects pastes from relays and from anyone who sees the stored data, not from a malicious copy of the app. The service worker caches the app shell, so a compromised build would reach returning visitors on their next update.
- **The fragment is never sent.** The secret lives after the `#` in the link. Browsers do not include the fragment in HTTP requests, and the page sets `referrer` to `no-referrer`. Anyone who gets the full link (chat history, browser sync, screenshots, a shoulder) can read the paste.
- **Link mode makes no network request** beyond same-origin static assets. The ciphertext is in the link itself.
- **Nostr mode** stores the ciphertext on public relays. Relays see the ciphertext, its size, the time of publication, the publishing key (a fresh one per paste) and your IP address. They do not see the key. A long paste is split into several events under the same key, so relays also see how many events it takes, and a reader opens it only if every event arrives intact: the encryption covers the whole paste, so a missing, reordered or forged part makes it unreadable rather than altered.

## Expiry and deletion are best effort

- **Nostr expiry** uses NIP-40 (`expiration` tag). Relays are asked to drop the event after that time; nothing forces them to.
- **Deletion and burn-after-reading** publish a replacement event with empty content under the same identifier (a tombstone) for every part of the paste, and a NIP-09 deletion request naming them all. The delete link does not record the number of parts, so deleting reads it from the first part on the relays; the tombstone on the first part alone already makes the paste unreadable. Relays that honour them stop serving the paste. A relay that ignores them, or anyone who copied the event earlier, keeps the ciphertext.
- **Concurrent burn race.** If two people open a burn-after-reading paste at the same time, both can read it before the tombstone reaches the relays.
- **Link-mode expiry is checked client side.** The expiry time is inside the encrypted payload and the app refuses to show an expired paste, but the link still holds the ciphertext. Anyone with the link and a modified client can decrypt it after expiry.

## Passwords

A password is a second factor on top of the key in the link. It is stretched with Argon2id and combined with the link secret, so a leaked link alone is not enough. A weak password can still be guessed offline by someone who has the link.

## Browser hardening

- Content Security Policy, set by a `<meta>` tag injected at build time: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' <relays>; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`. `connect-src` lists only the configured relays. `frame-ancestors` cannot be set from a `<meta>` tag and GitHub Pages does not allow custom headers, so framing is not blocked.
- `'wasm-unsafe-eval'` is needed for the Argon2id WebAssembly module. `'unsafe-inline'` for styles is needed by the editor. There is no `'unsafe-eval'` and no inline script.
- No analytics, no CDN, no third-party requests.
- Rendered Markdown is sanitised with DOMPurify. The raw view is a `text/plain` `blob:` URL.
- The service worker only caches same-origin files.
- **Trusted Types are not enforced.** The editor, the syntax highlighter and the UI framework write to the DOM through sinks that would need a policy. The only HTML insertion points are the highlighted code view and the sanitised Markdown view.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository (Security tab, "Report a vulnerability") rather than a public issue.
