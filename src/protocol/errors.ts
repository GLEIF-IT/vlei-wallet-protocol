import type { IssuedCredential } from "./types.js";

/**
 * Extension side. Throw from a handler to fail a request: the page that sent it receives
 * `/signify/reply` with `error` (= message) and `payload`, and its client call rejects.
 */
export class HandlerError extends Error {
  constructor(
    message: string,
    readonly payload?: object
  ) {
    super(message);
    this.name = "HandlerError";
  }
}

/**
 * Web side. Thrown by the wallet function `issueCredentials`; `issued` lists credentials that were
 * anchored before the failure (they stay issued). `[]` if the user denied.
 */
export class IssuanceFailure extends Error {
  constructor(
    message: string,
    readonly issued: IssuedCredential[]
  ) {
    super(message);
    this.name = "IssuanceFailure";
  }
}

/** A rejected client call: an `Error` whose `payload` is the error reply's payload, if any. */
export type ErrorWithPayload = Error & { payload?: unknown };
