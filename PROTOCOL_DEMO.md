# vLEI Wallet Protocol (demo)

How a web app talks to a vLEI wallet browser extension, and the `vlei-wallet-protocol` library that
implements both sides. Based on [polaris-web](https://github.com/WebOfTrust/polaris-web) (`main` @ `3bb7219`).

Items marked **TODO** are defined here but not implemented yet.

```
web app                                  import "vlei-wallet-protocol"
  ├─ wallet functions     connectIdentity, signRequest, issueCredentials, …   → section 2
  └─ ExtensionClient      one method per message (polaris-web)                → section 3
      ══ window.postMessage ══                                                 → section 4
extension                                import "vlei-wallet-protocol/extension"
  ├─ content script       createContentBridge: handshake, in-page prompts, relay → section 6
  └─ background           createBackgroundRouter: keys + KERIA client          → section 6
```

## Contents

1. [Quick start](#1-quick-start)
2. [Wallet functions](#2-wallet-functions)
3. [Client API and messages](#3-client-api-and-messages)
4. [Transport and handshake](#4-transport-and-handshake)
5. [Errors](#5-errors)
6. [Implementing an extension](#6-implementing-an-extension)
7. [Changes from polaris-web](#7-changes-from-polaris-web)
8. [Types](#8-types)

---

## 1. Quick start

```bash
npm install vlei-wallet-protocol
```

```ts
import {
  isExtensionInstalled,
  restoreSession,
  connectIdentity,
  signRequest,
  issueCredentials,
  IssuanceFailure,
} from "vlei-wallet-protocol";

// SAID of the credential schema to issue; the wallet's KERIA agent must already resolve it (schema OOBI)
const SCHEMA_SAID = "EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao";

if (!(await isExtensionInstalled())) throw new Error("vLEI Wallet extension not found");

// Sign in: reuse the tab's session, or ask the user to pick a credential
const auth = (await restoreSession()) ?? (await connectIdentity({ message: "Select your credential" }));
console.log("Signed in as", auth.identifier?.prefix);

// Signed request to your API
const url = "https://api.example.com/reports";
const res = await fetch(url, { headers: await signRequest(url, "GET") });
console.log("API status", res.status);

// Issue credentials (the user approves in the extension)
try {
  const issued = await issueCredentials([
    { schemaSaid: SCHEMA_SAID, registryName: "my-registry", attributes: { LEI: "5493001KJTIIGC8Y1R17" } },
  ]);
  console.log("Issued", issued.map((c) => c.said));
} catch (e) {
  // Credentials anchored before the failure stay issued: record them before retrying
  if (e instanceof IssuanceFailure) console.warn("Issued before failure", e.issued.map((c) => c.said));
  throw e;
}
```

---

## 2. Wallet functions

High-level functions exported by `vlei-wallet-protocol`. Each one calls the
[client](#3-client-api-and-messages) underneath.

### isExtensionInstalled

Checks whether a compatible extension is present.

| | |
|---|---|
| Uses | [handshake](#handshake) |
| Arguments | – |
| Returns | `string` (extension ID) \| `false` after 3 s |

### restoreSession

Returns the tab's current session, or `null` if there is none. Never throws.

| | |
|---|---|
| Uses | [`client.getSessionInfo`](#clientgetsessioninfo) |
| Arguments | – |
| Returns | `AuthorizeResult` \| `null` |

### connectIdentity

Asks the user to select a credential and starts a session.

| | |
|---|---|
| Uses | [`client.authorizeCred`](#clientauthorizecred) |
| Arguments | `args?: AuthorizeArgs` (`message` shown to the user, `schema` filter) |
| Returns | `AuthorizeResult` |
| Throws | `Error` if the user cancels |

### switchIdentity

Ends the current session and asks the user to select a credential again.

| | |
|---|---|
| Uses | [`client.clearSession`](#clientclearsession) (errors ignored) → [`connectIdentity`](#connectidentity) |
| Arguments | `args?: AuthorizeArgs` |
| Returns | `AuthorizeResult` |
| Throws | `Error` if the user cancels |

### refetchCredentialCesr

Fetches the CESR stream of a credential held by the wallet.

| | |
|---|---|
| Uses | [`client.getCredential`](#clientgetcredential) with `includeCESR: true` |
| Arguments | `said: string` |
| Returns | `string` (CESR) |
| Throws | `Error` if no CESR is returned |

### signRequest

Returns signed headers for an HTTP request, made with the session's identifier.

| | |
|---|---|
| Uses | [`client.signRequest`](#clientsignrequest) |
| Arguments | `url: string`, `method: string` |
| Returns | `Record<string, string>`: send the request with exactly these headers |
| Throws | `Error` if there is no session |

### issueCredentials

Issues credentials under the session's identifier after the user approves them in the extension.

| | |
|---|---|
| Uses | [`client.issueCredentials`](#clientissuecredentials) |
| Arguments | `credentials: IssueCredentialRequest[]` |
| Returns | `IssuedCredential[]` (request order) |
| Throws | `IssuanceFailure` with `issued`: credentials anchored before the failure (`[]` if the user denied) |

---

## 3. Client API and messages

`createClient(options?)` returns an `ExtensionClient` with one method per protocol message.

**Sessions.** A successful `authorize*` call binds the selected identifier to the current tab and origin
until `expiry` (epoch ms, chosen by the extension). Methods marked *required* below work only while that
session exists. With `session: { oneTime: true }`, no session is created and the reply carries one-time
signed `headers` instead. `authorize*` always prompts; `message` is shown in the prompt.

| Method | Message type | Session | User prompt |
|---|---|---|---|
| [`authorize`](#clientauthorize) | `/signify/authorize` | creates | yes |
| [`authorizeAid`](#clientauthorizeaid) | `/signify/authorize/aid` | creates | yes |
| [`authorizeCred`](#clientauthorizecred) | `/signify/authorize/credential` | creates | yes |
| [`authorizeAutoSignin`](#clientauthorizeautosignin) **TODO** | `/signify/authorize-auto-signin` | creates | unless enabled |
| [`getSessionInfo`](#clientgetsessioninfo) | `/signify/get-session-info` | reads | – |
| [`clearSession`](#clientclearsession) | `/signify/clear-session` | ends | – |
| [`signRequest`](#clientsignrequest) | `/signify/sign-request` | required | – |
| [`signData`](#clientsigndata) | `/signify/sign-data` | required | – |
| [`getCredential`](#clientgetcredential) | `/signify/credential/get` | – | – |
| [`issueCredentials`](#clientissuecredentials) | `/signify/credential/issue` | required | yes, extension window |
| [`createDataAttestationCredential`](#clientcreatedataattestationcredential) | `/signify/credential/create/data-attestation` | required | – |
| [`configureVendor`](#clientconfigurevendor) | `/signify/configure-vendor` | – | – |
| [`isExtensionInstalled`](#clientisextensioninstalled) | [handshake](#handshake) | – | – |
| [`sendMessage`](#clientsendmessage) | any | – | – |

### client.authorize

| | |
|---|---|
| Description | Asks the user to select an identifier or a credential; starts a session |
| Message type | `/signify/authorize` |
| Payload | `{ message?: string; session?: { oneTime?: boolean } }` |
| Extra field | `schema?: string`: schema SAID, sent at the top level of the message (not in `payload`); only credentials of that schema are offered |
| Reply payload | `AuthorizeResult`: `{ identifier?: { prefix, name? }, credential?: { raw, cesr }, expiry?, headers? }`: `expiry` in session mode, `headers` in one-time mode |

### client.authorizeAid

| | |
|---|---|
| Description | Like `authorize`, identifiers only |
| Message type | `/signify/authorize/aid` |
| Payload | `{ message?: string; session?: { oneTime?: boolean } }` |
| Reply payload | `AuthorizeResult` without `credential` |

### client.authorizeCred

| | |
|---|---|
| Description | Like `authorize`, credentials only; the session's identifier is the credential's holder |
| Message type | `/signify/authorize/credential` |
| Payload | `{ message?: string; session?: { oneTime?: boolean } }` |
| Extra field | `schema?: string` (as in `authorize`) |
| Reply payload | `AuthorizeResult` |

### client.authorizeAutoSignin

**TODO** (stub, reserved for later use).

| | |
|---|---|
| Description | Signs in with the sign-in the user marked for auto sign-in on this origin; prompts if there is none |
| Message type | `/signify/authorize-auto-signin` |
| Payload | `{ message?: string; session?: { oneTime?: boolean } }` |
| Reply payload | `AuthorizeResult` |

### client.getSessionInfo

| | |
|---|---|
| Description | Returns the current session of this tab and origin; error `Session not found` if there is none |
| Message type | `/signify/get-session-info` |
| Payload | – |
| Reply payload | `AuthorizeResult` (`identifier`, `credential?`, `expiry`) |

### client.clearSession

| | |
|---|---|
| Description | Ends the session of this tab and origin |
| Message type | `/signify/clear-session` |
| Payload | – |
| Reply payload | `{}` (also when there was no session) |

### client.signRequest

| | |
|---|---|
| Description | Signs an HTTP request with the session's identifier (KERI signed headers) |
| Message type | `/signify/sign-request` |
| Payload | `{ url: string; method?: string; headers?: Record<string, string> }` (`method` defaults to `"GET"`) |
| Reply payload | `{ headers: Record<string, string> }` |

### client.signData

| | |
|---|---|
| Description | Signs UTF-8 strings with the session's identifier |
| Message type | `/signify/sign-data` |
| Payload | `{ message?: string; items: string[] }` |
| Reply payload | `{ aid: string; items: { data: string; signature: string }[] }` (CESR signatures, request order) |

### client.getCredential

| | |
|---|---|
| Description | Fetches a credential held by the wallet |
| Message type | `/signify/credential/get` |
| Payload | `{ id: string; includeCESR?: boolean }` (`id` is the credential SAID) |
| Reply payload | `{ credential }`: the ACDC object, or its CESR string when `includeCESR` is `true` |

### client.issueCredentials

| | |
|---|---|
| Description | Issues credentials of any schema under the session's identifier, after the user approves them in an extension window |
| Message type | `/signify/credential/issue` |
| Payload | `{ credentials: IssueCredentialRequest[] }` |
| Reply payload | `{ credentials: IssuedCredential[] }` (request order) |
| Error payload | `{ issued: IssuedCredential[] }`: credentials anchored before the failure; they stay issued |

| `IssueCredentialRequest` field | Rule |
|---|---|
| `schemaSaid` | Required; the schema must already be resolved by the wallet's KERIA agent |
| `registryName` | Required; created if the issuer has none with this name |
| `attributes` | Required; no `d` or `i` |
| `edges`, `rules` | Optional; their `d` is computed |

Credentials are issued one by one in request order, and issuance stops at the first failure.

### client.createDataAttestationCredential

| | |
|---|---|
| Description | Issues one untargeted credential (no issuee) under the session's identifier |
| Message type | `/signify/credential/create/data-attestation` |
| Payload | `{ schemaSaid: string; credData: object }` |
| Reply payload | `{ acdc; iss; anc; op }` |

### client.configureVendor

| | |
|---|---|
| Description | Asks the extension to use a vendor JSON (name, logo, theme); the user confirms it in the extension. Format in [GETTING_STARTED_VENDOR.md](https://github.com/GLEIF-IT/signify-browser-extension/blob/main/GETTING_STARTED_VENDOR.md) |
| Message type | `/signify/configure-vendor` |
| Payload | `{ url: string }` |
| Reply payload | `{}` |

### client.isExtensionInstalled

| | |
|---|---|
| Description | Resolves with the extension ID from the [handshake](#handshake), or `false` after `timeout` ms (default `3000`) |
| Message type | handshake |

### client.sendMessage

| | |
|---|---|
| Description | Sends any message type: `sendMessage(type, { payload, ...extra })`; resolves with the reply payload |
| Message type | any |

`client.dispose()` stops listening and rejects pending requests.

---

## 4. Transport and handshake

### Messages

All messages travel through `window.postMessage` on the tab's own `window`. Both sides ignore messages from
other windows (`event.source !== window`) and messages without a string `type`.

| | Shape |
|---|---|
| Request | `{ type, requestId, payload?, ...extra }`, where `requestId` is unique per request |
| Success reply | `{ type: "/signify/reply", requestId, payload }`, `payload` is always an object |
| Error reply | `{ type: "/signify/reply", requestId, error: string, payload? }` |

The extension sends exactly one reply per request, including an error reply for message types it does not
support. Unknown fields are ignored on both sides. There is no built-in timeout: prompts and issuance can
take minutes.

### Handshake

How the web app learns that an extension is installed.

| Message | Sent by | When |
|---|---|---|
| `{ type: "signify-extension-client" }` | web app (client) | Once, when the client is created: "is an extension here?" |
| `{ type: "signify-extension", data: { extensionId } }` | extension (content script) | 1. When the content script is injected into the page (this extension: `run_at: "document_end"` in `manifest.json`).<br>2. Every time it receives `signify-extension-client`. |

Both triggers are needed: the web app may create its client before or after the content script is injected.

---

## 5. Errors

An error reply rejects the client promise with an `Error`:

| Field | Value |
|---|---|
| `message` | the reply's `error` string |
| `payload` | the reply's `payload`, if any |

The wallet function `issueCredentials` turns this into an `IssuanceFailure`, whose `issued` field lists the
credentials anchored before the failure.

| Situation | `error` (constant in `PROTOCOL_ERRORS`) |
|---|---|
| User closed the sign-in prompt | `request has been cancelled` (`cancelled`) |
| User denied issuance | `User rejected` (`userRejected`) |
| No session | `Session not found` (`sessionNotFound`) |
| Missing payload | `missing data` (`missingData`) |
| Message type the extension does not support | `Unsupported message type: <type>` (`unsupported(type)`) |
| Request from a background tab | `Request did not come from the active tab` (`notActiveTab`) |
| Success reply without an object payload (client side) | `No payload received in response` (`noPayload`) |

Match on these only to choose what to show; the texts are informative.

---

## 6. Implementing an extension

`vlei-wallet-protocol/extension` provides both halves; the extension supplies the prompts and the KERIA
work. Reference: the vLEI Wallet extension (`src/pages/content/index.tsx`,
`src/pages/background/handlers/protocol.ts` in signify-browser-extension).

**Content script** ([Chrome docs](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)):
extension code that runs inside the web page. `createContentBridge` answers the [handshake](#handshake) on
injection and on every `signify-extension-client`, accepts page messages as described in
[Messages](#messages), and posts exactly one `/signify/reply` per `requestId`. Requests are answered by a
`local` handler (prompts rendered in the page) or forwarded to the background.

```ts
import browser from "webextension-polyfill";
import { createContentBridge, forwardViaRuntime, HandlerError, PROTOCOL_ERRORS } from "vlei-wallet-protocol/extension";

createContentBridge({
  extensionId: browser.runtime.id,
  forward: forwardViaRuntime((envelope) => browser.runtime.sendMessage(envelope)),
  local: {
    // Resolve with the reply payload, or throw HandlerError(PROTOCOL_ERRORS.cancelled) when the user closes it.
    "/signify/authorize/aid": (request) => showSigninDialog(request),
  },
});
```

**Background** ([Chrome docs: service worker](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers)):
the extension's service worker. It holds the KERIA client and keys and does all signing and issuing. The
content script reaches it through
[extension messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging).

```ts
import { createBackgroundRouter, createRuntimeListener, isRuntimeEnvelope, HandlerError, PROTOCOL_ERRORS } from "vlei-wallet-protocol/extension";

const router = createBackgroundRouter({
  "/signify/clear-session": async (_request, { tabId, origin }) => { await sessions.remove(tabId, origin); }, // replies {}
  "/signify/get-session-info": async (_request, { tabId, origin }) =>
    (await sessions.get(tabId, origin)) ?? Promise.reject(new HandlerError(PROTOCOL_ERRORS.sessionNotFound)),
});
const listener = createRuntimeListener(router, browser.runtime.id, { requireActiveTab: true });

browser.runtime.onMessage.addListener((message, sender) => {
  if (isRuntimeEnvelope(message)) return listener(message, sender); // the reply travels back as the response
  // … the extension's own messages
});
```

- The request's origin and tab come from the browser's `sender` (`RequestContext`), never from the message.
- Bind sessions to tab + origin.
- To fail a request, throw `HandlerError(message, payload?)`: the page that sent the request receives
  `/signify/reply` with `error` (and `payload`), and its client call rejects. A handler that returns nothing
  replies `{}`. Types without a handler get `Unsupported message type: <type>`.
- `requireActiveTab` answers requests from background tabs with an error instead of acting on them.

**Checklist**

- [ ] [Handshake](#handshake): on injection and on every `signify-extension-client` (`createContentBridge`)
- [ ] One reply per request, `{}` when there is nothing to return ([Messages](#messages))
- [ ] Error reply for unsupported message types ([Messages](#messages))
- [ ] Prompt for `authorize*`, show `message`, apply the top-level `schema` filter (credential `sad.s`)
- [ ] Issuance approved in an extension window; `issued` reported on failure
- [ ] Keys and passcode never reach the page

---

## 7. Changes from polaris-web

| Change | |
|---|---|
| **Added** wallet functions | [Section 2](#2-wallet-functions) |
| **Added** `issueCredentials` / `/signify/credential/issue`, `IssuanceFailure` | Batch issuance with partial results |
| **Added** `schema` in `authorize` / `authorizeCred` | Credential filter, top-level field |
| **Added** `payload` on rejected errors | Error replies keep their payload |
| **Added** `expiry`, `identifier.name` in `AuthorizeResult` | What extensions already return |
| **Added** extension side | `createContentBridge`, `createBackgroundRouter`, runtime glue, `HandlerError`, [section 8](#extension-side) |
| **Clarified** replies | One per request, `{}` when empty, error for unknown types, handshake re-announcement |
| **TODO** `authorizeAutoSignin` | Stub for an existing extension message; extensions may answer it as unsupported |
| **Removed** `configWorkflowIssueCredential` | No extension implements it |

---

## 8. Types

### Shared

```ts
export interface SessionArgs {
  oneTime?: boolean;
}

export interface AuthorizeArgs {
  message?: string;
  session?: SessionArgs;
  /** Schema SAID filter; sent as a top-level message field. */
  schema?: string;
}

export interface AuthorizeResultCredential {
  raw: unknown;
  cesr: string;
}

export interface AuthorizeResultIdentifier {
  prefix: string;
  name?: string;
}

export interface AuthorizeResult {
  credential?: AuthorizeResultCredential;
  identifier?: AuthorizeResultIdentifier;
  /** One-time mode: headers signed for the page origin. */
  headers?: Record<string, string>;
  /** Session mode: when the session ends, epoch ms. */
  expiry?: number;
}

export interface SignRequestArgs {
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

export interface SignRequestResult {
  headers: Record<string, string>;
}

export interface SignDataArgs {
  message?: string;
  items: string[];
}

export interface SignDataResultItem {
  data: string;
  signature: string;
}

export interface SignDataResult {
  aid: string;
  items: SignDataResultItem[];
}

export interface CredentialResult {
  credential: any;
}

export interface CreateDataAttestationCredentialArgs {
  credData: any;
  schemaSaid: string;
}

export interface CreateDataAttestationCredentialResult {
  acdc: Record<string, any>;
  iss: Record<string, any>;
  anc: Record<string, any>;
  op: Record<string, any>;
}

export interface ConfigureVendorArgs {
  url: string;
}

export interface IssueCredentialRequest {
  schemaSaid: string;
  registryName: string;
  attributes: Record<string, unknown>;
  edges?: Record<string, unknown>;
  rules?: Record<string, unknown>;
}

export interface IssuedCredential {
  said: string;
  schemaSaid: string;
  registryName: string;
  issuer: string;
  issuedAt: string | null;
}
```

### Web app side

```ts
export interface ExtensionClientOptions {
  targetOrigin?: string;
}

export class ExtensionClient {
  constructor(options?: ExtensionClientOptions);
  /** Stops listening and rejects pending requests. */
  dispose(): void;
  isExtensionInstalled(timeout?: number): Promise<string | false>;
  authorize(args?: AuthorizeArgs): Promise<AuthorizeResult>;
  authorizeAid(args?: AuthorizeArgs): Promise<AuthorizeResult>;
  authorizeCred(args?: AuthorizeArgs): Promise<AuthorizeResult>;
  /** TODO: stub. */
  authorizeAutoSignin(args?: AuthorizeArgs): Promise<AuthorizeResult>;
  getSessionInfo(): Promise<AuthorizeResult>;
  clearSession(): Promise<AuthorizeResult>;
  signRequest(args: SignRequestArgs): Promise<SignRequestResult>;
  signData(args: SignDataArgs): Promise<SignDataResult>;
  getCredential(said: string, includeCESR?: boolean): Promise<CredentialResult>;
  issueCredentials(args: { credentials: IssueCredentialRequest[] }): Promise<{ credentials: IssuedCredential[] }>;
  createDataAttestationCredential(args: CreateDataAttestationCredentialArgs): Promise<CreateDataAttestationCredentialResult>;
  configureVendor(args: ConfigureVendorArgs): Promise<void>;
  sendMessage<TRequest extends object, TResponse>(type: string, message?: TRequest): Promise<TResponse>;
}

export declare function createClient(options?: ExtensionClientOptions): ExtensionClient;

export class IssuanceFailure extends Error {
  constructor(
    message: string,
    readonly issued: IssuedCredential[]
  ) {
    super(message);
    this.name = "IssuanceFailure";
  }
}

// Wallet functions
export declare function isExtensionInstalled(): Promise<string | false>;
export declare function restoreSession(): Promise<AuthorizeResult | null>;
export declare function connectIdentity(args?: AuthorizeArgs): Promise<AuthorizeResult>;
export declare function switchIdentity(args?: AuthorizeArgs): Promise<AuthorizeResult>;
export declare function refetchCredentialCesr(said: string): Promise<string>;
export declare function signRequest(url: string, method: string): Promise<Record<string, string>>;
export declare function issueCredentials(credentials: IssueCredentialRequest[]): Promise<IssuedCredential[]>;
```

### Extension side

```ts
/** Message type → payload, extra top-level fields, reply payload. An interface: extend it with module augmentation. */
export interface ProtocolMap {
  "/signify/authorize": { payload: Omit<AuthorizeArgs, "schema">; extra: { schema?: string }; result: AuthorizeResult };
  "/signify/authorize/aid": { payload: Omit<AuthorizeArgs, "schema">; extra: {}; result: AuthorizeResult };
  "/signify/authorize/credential": { payload: Omit<AuthorizeArgs, "schema">; extra: { schema?: string }; result: AuthorizeResult };
  "/signify/authorize-auto-signin": { payload: Omit<AuthorizeArgs, "schema">; extra: {}; result: AuthorizeResult };
  "/signify/get-session-info": { payload: undefined; extra: {}; result: AuthorizeResult };
  "/signify/clear-session": { payload: undefined; extra: {}; result: {} };
  "/signify/sign-request": { payload: SignRequestArgs; extra: {}; result: SignRequestResult };
  "/signify/sign-data": { payload: SignDataArgs; extra: {}; result: SignDataResult };
  "/signify/credential/get": { payload: { id: string; includeCESR?: boolean }; extra: {}; result: CredentialResult };
  "/signify/credential/issue": {
    payload: { credentials: IssueCredentialRequest[] };
    extra: {};
    result: { credentials: IssuedCredential[] };
  };
  "/signify/credential/create/data-attestation": { payload: CreateDataAttestationCredentialArgs; extra: {}; result: CreateDataAttestationCredentialResult };
  "/signify/configure-vendor": { payload: ConfigureVendorArgs; extra: {}; result: {} };
}

export type MessageType = keyof ProtocolMap & string;

/** Page → extension request: `{ type, requestId, payload?, ...extra }`. */
export type RequestEnvelope<T extends MessageType = MessageType> = {
  type: T;
  requestId: string;
  payload?: ProtocolMap[T]["payload"];
} & ProtocolMap[T]["extra"];

/** Request facts taken from the browser, not from the message. */
export interface RequestContext {
  origin: string;
  tabId: number;
  requestId: string;
}

/** Throw from a handler to send an error reply; `payload` goes into the reply. */
export class HandlerError extends Error {
  constructor(
    message: string,
    readonly payload?: object
  ) {
    super(message);
    this.name = "HandlerError";
  }
}

// Content script

/** Answered in the content script (e.g. a prompt rendered in the page) instead of the background. */
export type LocalHandler<T extends MessageType> = (request: RequestEnvelope<T>) => Promise<ProtocolMap[T]["result"]> | ProtocolMap[T]["result"];
export type LocalHandlers = { [T in MessageType]?: LocalHandler<T> };

export interface ExtensionBridgeOptions {
  extensionId: string;
  /** Delivers a request to the background and resolves with its reply payload (see forwardViaRuntime). */
  forward(message: RequestEnvelope): Promise<unknown>;
  local?: LocalHandlers;
  /** Default: the global window. */
  window?: Window;
  /** Default: the page's own origin. */
  targetOrigin?: string;
}

export declare function createContentBridge(options: ExtensionBridgeOptions): { dispose(): void };

// Background

export type ProtocolHandler<T extends MessageType> = (
  request: { payload: ProtocolMap[T]["payload"] } & ProtocolMap[T]["extra"],
  context: RequestContext
) => Promise<ProtocolMap[T]["result"] | void> | ProtocolMap[T]["result"] | void;

/** One handler per message type, implemented in the background. */
export type ProtocolHandlers = { [T in MessageType]: ProtocolHandler<T> };

/** What the background sends back to the content script: plain data, survives runtime serialization. */
export type RouterResponse = { ok: true; payload: object } | { ok: false; error: string; payload?: object };

export interface BackgroundRouter {
  handle(message: RequestEnvelope, context: RequestContext): Promise<RouterResponse>;
  supports(type: string): boolean;
}

export declare function createBackgroundRouter(
  handlers: Partial<ProtocolHandlers>,
  options?: { onError?(error: unknown, message: RequestEnvelope, context: RequestContext): void }
): BackgroundRouter;

// Runtime messaging glue (structural types: chrome.*, browser.*, webextension-polyfill)

export interface RuntimeEnvelope {
  channel: "vlei-wallet-protocol";
  message: RequestEnvelope;
}

export interface RuntimeSender {
  id?: string;
  origin?: string;
  url?: string;
  tab?: { id?: number; url?: string; active?: boolean };
}

export declare function forwardViaRuntime(
  sendMessage: (envelope: RuntimeEnvelope) => Promise<unknown>
): (message: RequestEnvelope) => Promise<object>;

/** Promise for protocol envelopes from `extensionId`, `undefined` for anything else. */
export declare function createRuntimeListener(
  router: BackgroundRouter,
  extensionId?: string,
  options?: { requireActiveTab?: boolean }
): (message: unknown, sender: RuntimeSender) => Promise<RouterResponse> | undefined;

export declare function isRuntimeEnvelope(value: unknown): value is RuntimeEnvelope;
export declare function contextFromSender(sender: RuntimeSender, requestId: string): RequestContext;
```
