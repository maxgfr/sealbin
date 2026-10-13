/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Comma-separated relay override, injected at build time by vite.config.ts. */
  readonly SEALBIN_RELAYS?: string;
}
