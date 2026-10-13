# sealbin

## What it is
sealbin is an encrypted pastebin that runs entirely in the browser, hosted as a static site on GitHub Pages. It descends from wastebin (minimal, fast, code-first paste sharing) but drops the server: the paste is compressed and encrypted (AES-GCM) client-side, and the key lives only in the URL fragment, which never leaves the browser. Zero-knowledge by construction.

## Two sharing modes
- **Link**: the whole encrypted paste lives in the URL fragment. Works offline, needs no network, produces a long URL.
- **Short link (Nostr)**: the ciphertext is published to Nostr relays (kind 30078 with expiration); the URL carries only an id and the key. Short URL, depends on relays, supports burn-after-reading and deletion.

## Audience
Developers sharing code, logs, configs and secrets with other developers. They live in terminals and editors, read monospace all day, use keyboard shortcuts, and distrust tools that look like marketing. English only.

## Surface and mode
One product surface, **Operate** mode: compose, view, burn interstitial, password prompt, delete, not found. No landing page; the composer is the home page.

## Personality
Precise, quiet, trustworthy. A well-made instrument rather than a brand. Copy is terse and literal: controls name their action, errors name the problem and the recovery ("Wrong password. Try again or ask the sender for it.").

## Design direction: "sealed document"
- Terminal-adjacent but not retro: a monospace-forward UI (JetBrains Mono, self-hosted via npm) on calm paper/ink neutrals with a slight warm tint.
- One signal color, **seal red-orange** (wax seal), used sparingly for the primary action and the encrypted state. Everything else stays neutral.
- State colors are semantic and reserved: amber warning for expiry and burn-after-reading, red for errors, green for copied/published, a high-contrast blue focus ring.
- Light and dark are both first-class (developers use either); follows the OS, overridable with `[data-theme]`.
- Flat surfaces, hairline borders, shadows only on dialogs. Small radii (4-8px). Motion is short and functional, and disabled under reduced motion.

## Anti-references
Glossy SaaS hero sections, gradient blobs, padlock clip-art, "military-grade" security language, cards nested in cards.

## Constraints
No external requests (strict CSP): no Google Fonts or CDNs. WCAG AA contrast, visible keyboard focus, full keyboard operation.
