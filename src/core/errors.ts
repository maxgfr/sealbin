/**
 * Typed errors of the core, in a module with no dependencies so the UI can tell them apart
 * (`instanceof`) without loading the crypto or Nostr code. crypto.ts and nostr.ts re-export them.
 */
export class SealbinError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}
/** The key does not decrypt this payload (wrong link, tampered data, or wrong author binding). */
export class WrongKeyError extends SealbinError {}
/** The payload is password-protected and the password does not decrypt it. */
export class WrongPasswordError extends SealbinError {}
/** The payload is password-protected and no password was supplied. */
export class PasswordRequiredError extends SealbinError {}
export class ExpiredError extends SealbinError {
  constructor(readonly expiresAt: number) {
    super(`Paste expired at ${new Date(expiresAt).toISOString()}`);
  }
}
export class UnsupportedVersionError extends SealbinError {
  constructor(readonly version: number) {
    super(`Unsupported payload version ${version}`);
  }
}
export class TooLargeError extends SealbinError {
  constructor(
    readonly size: number,
    readonly limit: number,
  ) {
    super(`Too large: ${size} bytes (limit ${limit})`);
  }
}
/** Structurally invalid input (bad base64, truncated, bad header, bad JSON shape). */
export class CorruptPayloadError extends SealbinError {}

/** No relay holds a readable paste for this id (never published, deleted, burned or expired). */
export class NotFoundError extends SealbinError {}
/** No relay could be reached, or none accepted the event. */
export class RelaysUnreachableError extends SealbinError {}
