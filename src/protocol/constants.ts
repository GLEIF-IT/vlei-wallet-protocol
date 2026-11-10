/** Request message types (`type` field of a page → extension message). Values match polaris-web. */
export const MESSAGE_TYPES = {
  authorize: "/signify/authorize",
  authorizeAid: "/signify/authorize/aid",
  authorizeCred: "/signify/authorize/credential",
  /** TODO: stub, reserved for later use. */
  authorizeAutoSignin: "/signify/authorize-auto-signin",
  getSessionInfo: "/signify/get-session-info",
  clearSession: "/signify/clear-session",
  signRequest: "/signify/sign-request",
  signData: "/signify/sign-data",
  getCredential: "/signify/credential/get",
  issueCredentials: "/signify/credential/issue",
  createDataAttestationCredential: "/signify/credential/create/data-attestation",
  configureVendor: "/signify/configure-vendor",
} as const;

/** Prefix shared by every request type and the reply type. */
export const MESSAGE_PREFIX = "/signify/";

/** Type of every extension → page reply. */
export const REPLY_TYPE = "/signify/reply";

/** Handshake message types. See PROTOCOL_DEMO.md §4 "Handshake". */
export const HANDSHAKE = {
  /** Page → extension: "is an extension here?" Sent once when a client is created. */
  client: "signify-extension-client",
  /** Extension → page: `{ type, data: { extensionId } }`. Sent on injection and on every `client` message. */
  extension: "signify-extension",
} as const;

/** Default time `isExtensionInstalled` waits for the handshake, in ms. */
export const DEFAULT_HANDSHAKE_TIMEOUT = 3000;

/** Known `error` strings of error replies. See PROTOCOL_DEMO.md §5. */
export const PROTOCOL_ERRORS = {
  cancelled: "request has been cancelled",
  userRejected: "User rejected",
  sessionNotFound: "Session not found",
  missingData: "missing data",
  noPayload: "No payload received in response",
  unsupported: (type: string) => `Unsupported message type: ${type}`,
  /** Runtime sender is not a tab (extension side). */
  notFromTab: "Request did not come from a tab",
  /** Runtime sender is a background tab and the listener requires the active one (extension side). */
  notActiveTab: "Request did not come from the active tab",
  /** The background did not answer a forwarded request (extension side). */
  noBackgroundResponse: "No response from the extension background",
} as const;
