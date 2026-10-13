/**
 * User-facing copy for every error a reader can hit. Each typed error maps to a title (the
 * problem), a body (why, and what to do) and one action. The test enumerates the error classes
 * exported by core so a new class cannot ship without its copy.
 */
import {
  CorruptPayloadError,
  ExpiredError,
  NotFoundError,
  PasswordRequiredError,
  RelaysUnreachableError,
  SealbinError,
  TooLargeError,
  UnsupportedVersionError,
  WrongKeyError,
  WrongPasswordError,
} from "../../core/errors";

/** `retry` runs the same operation again; `home` opens a new paste; `password` asks again. */
export type ErrorActionKind = "retry" | "home" | "password";

export interface ErrorCopy {
  title: string;
  body: string;
  action: { kind: ErrorActionKind; label: string };
}

const HOME = { kind: "home", label: "New paste" } as const;
const RETRY = { kind: "retry", label: "Try again" } as const;

type ErrorClass = abstract new (...args: never[]) => Error;

/** Most specific classes first: the first `instanceof` match wins. */
const TABLE: [ErrorClass, (err: never) => ErrorCopy][] = [
  [
    WrongKeyError,
    () => ({
      title: "This link can't open the paste",
      body: "The key in the link doesn't match. The link may be cut short or altered. Ask the sender for it again.",
      action: HOME,
    }),
  ],
  [
    WrongPasswordError,
    () => ({
      title: "Wrong password",
      body: "Wrong password. Try again or ask the sender for it.",
      action: { kind: "password", label: "Enter password" },
    }),
  ],
  [
    PasswordRequiredError,
    () => ({
      title: "This paste needs a password",
      body: "The sender protected it with a password. Enter it to open the paste.",
      action: { kind: "password", label: "Enter password" },
    }),
  ],
  [
    ExpiredError,
    (err: ExpiredError) => ({
      title: "This paste has expired",
      body: `It expired on ${new Date(err.expiresAt).toLocaleString()}. Ask the sender for a new link.`,
      action: HOME,
    }),
  ],
  [
    NotFoundError,
    () => ({
      title: "This paste is gone",
      body: "It was deleted, destroyed after reading, or it expired. The relays no longer hold it.",
      action: HOME,
    }),
  ],
  [
    RelaysUnreachableError,
    () => ({
      title: "Can't reach the relays",
      body: "None of the Nostr relays answered. Check your connection, then try again.",
      action: RETRY,
    }),
  ],
  [
    TooLargeError,
    (err: TooLargeError) => ({
      title: "This paste is too large",
      body: `It holds ${err.size.toLocaleString("en")} bytes; the limit is ${err.limit.toLocaleString("en")}.`,
      action: HOME,
    }),
  ],
  [
    UnsupportedVersionError,
    (err: UnsupportedVersionError) => ({
      title: "This paste needs a newer sealbin",
      body: `It uses format version ${err.version}, which this version can't read. Reload the page to update.`,
      action: RETRY,
    }),
  ],
  [
    CorruptPayloadError,
    () => ({
      title: "This link is damaged",
      body: "The encrypted data is incomplete or malformed. Check that you copied the whole link.",
      action: HOME,
    }),
  ],
  [
    SealbinError,
    () => ({
      title: "This paste can't be opened",
      body: "Something about this paste is not right. Ask the sender for the link again.",
      action: HOME,
    }),
  ],
];

const FALLBACK: ErrorCopy = {
  title: "Something went wrong",
  body: "An unexpected error stopped sealbin. Try again, or reload the page.",
  action: RETRY,
};

export function describeError(err: unknown): ErrorCopy {
  for (const [Kind, copy] of TABLE) {
    if (err instanceof Kind) return (copy as (e: Error) => ErrorCopy)(err);
  }
  if (err instanceof Error && err.message) {
    return { ...FALLBACK, body: `${err.message}. Try again, or reload the page.` };
  }
  return FALLBACK;
}

/** The generic copy for errors sealbin does not know: the test checks typed errors avoid it. */
export const FALLBACK_TITLE = FALLBACK.title;
