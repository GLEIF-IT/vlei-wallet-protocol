# vlei-wallet-protocol

> [!TIP]
> **New here and want a quick start? Go to [docs/HACKMD.md](./docs/HACKMD.md).** It walks you from zero to a working
> web app and a demo wallet extension in a few minutes. This README goes deep: entry points, installation options,
> the full API, extending the protocol and tests.

This is one library for both sides of the web app ↔ vLEI wallet browser extension protocol
(polaris-web compatible). The protocol is specified in [PROTOCOL_DEMO.md](./PROTOCOL_DEMO.md).
Web apps and extensions import the same message types, payload types, error strings and envelope rules.

| Entry | For | Contents |
|---|---|---|
| `vlei-wallet-protocol` | web apps | `createClient` / `ExtensionClient`, wallet functions, `IssuanceFailure`, shared protocol |
| `vlei-wallet-protocol/extension` | extensions | `createContentBridge`, `createBackgroundRouter`, `HandlerError`, runtime glue, shared protocol |
| `vlei-wallet-protocol/protocol` | both | constants (`MESSAGE_TYPES`, `REPLY_TYPE`, `HANDSHAKE`, `PROTOCOL_ERRORS`), `ProtocolMap`, types, guards, errors |

ESM only, no runtime dependencies, works in Chrome and Firefox (no `chrome.*` types needed).

## Install

Not on a registry: install it from the git repository, pinned to a release tag. npm clones the repository, runs its
`prepare` script (which builds `dist/`) and installs the result like any other package.

```bash
npm install github:GLEIF-IT/vlei-wallet-protocol#v0.1.1
```

```json
{ "dependencies": { "vlei-wallet-protocol": "github:GLEIF-IT/vlei-wallet-protocol#v0.1.1" } }
```

To work on the library and an app side by side, depend on a local checkout instead and rebuild after every change:

```bash
cd vlei-wallet-protocol && npm install && npm run build
```

```json
{ "dependencies": { "vlei-wallet-protocol": "file:../vlei-wallet-protocol" } }
```

`npm pack` builds and packs `dist/`, `src/` (source maps), this README and PROTOCOL_DEMO.md; examples and tests
are not published. TypeScript projects on `moduleResolution: "node"` resolve the `/extension` and `/protocol`
subpaths through `typesVersions`.

## Web app

```ts
import {
  isExtensionInstalled,
  restoreSession,
  connectIdentity,
  signRequest,
  issueCredentials,
  IssuanceFailure,
} from "vlei-wallet-protocol";

// SAID of the credential schema to issue. The wallet's KERIA must be able to resolve it (schema OOBI).
const SCHEMA_SAID = "EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao";

if (!(await isExtensionInstalled())) throw new Error("vLEI Wallet extension not found");
const auth = (await restoreSession()) ?? (await connectIdentity({ message: "Select your credential" }));
console.log("Signed in as", auth.identifier ?? auth.credential);

const url = "https://api.example.com/reports";
await fetch(url, { headers: await signRequest(url, "GET") });

try {
  await issueCredentials([
    { schemaSaid: SCHEMA_SAID, registryName: "my-registry", attributes: { LEI: "5493001KJTIIGC8Y1R17" } },
  ]);
} catch (e) {
  // Credentials anchored before the failure are real; record them before retrying.
  if (e instanceof IssuanceFailure) console.warn("Issued before failure:", e.issued.map((c) => c.said));
  throw e;
}
```

Wallet functions share one client, created on first call (importing the module never touches `window`, so it is
SSR-safe). For anything else use the client directly: `createClient().signData({ items })`, or
`client.sendMessage(type, { payload, ...extra })` for any message type.

## Extension

**Content script** - answers the handshake, shows in-page prompts (`local` handlers) and relays the rest to the
background; exactly one `/signify/reply` per request:

```ts
// `chrome` comes from @types/chrome (Firefox: use `browser` from webextension-polyfill).
import { createContentBridge, forwardViaRuntime, HandlerError, PROTOCOL_ERRORS } from "vlei-wallet-protocol/extension";

createContentBridge({
  extensionId: chrome.runtime.id,
  forward: forwardViaRuntime((envelope) => chrome.runtime.sendMessage(envelope)),
  local: {
    // A sign-in dialog rendered in the page: resolve with the AuthorizeResult, or
    // throw new HandlerError(PROTOCOL_ERRORS.cancelled) when the user closes it.
    "/signify/authorize/aid": (request) => showSigninDialog(request.payload?.message),
  },
});
```

**Background** - one typed handler per supported message type. Origin and tab come from the browser's `sender`,
never from the message. Throw `HandlerError(message, payload?)` to send an error reply; return nothing to reply `{}`.
Unregistered types get an `Unsupported message type: …` error reply. `requireActiveTab` answers requests from
background tabs with an error.

```ts
import type { SignifyClient } from "signify-ts";
import {
  createBackgroundRouter,
  createRuntimeListener,
  HandlerError,
  PROTOCOL_ERRORS,
} from "vlei-wallet-protocol/extension";

declare const signify: SignifyClient;     // your connected client (signify-ts)
const sessions = new Map<string, string>(); // `${tabId} ${origin}` → AID name, set by the authorize handlers

const router = createBackgroundRouter({
  "/signify/sign-request": async ({ payload }, { origin, tabId }) => {
    const aidName = sessions.get(`${tabId} ${origin}`);
    if (!aidName) throw new HandlerError(PROTOCOL_ERRORS.sessionNotFound);
    const signed = await signify.createSignedRequest(aidName, payload.url, { method: payload.method ?? "GET" });
    return { headers: Object.fromEntries(signed.headers.entries()) };
  },
  "/signify/clear-session": (_request, { origin, tabId }) => {
    sessions.delete(`${tabId} ${origin}`);
  },
});

const listener = createRuntimeListener(router, chrome.runtime.id, { requireActiveTab: true });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const response = listener(message, sender);
  if (!response) return false;          // not protocol traffic: let other listeners answer
  response.then(sendResponse);
  return true;                          // raw chrome.*: keep the channel open
});
```

`test/live/reference-handlers.ts` is a complete reference background built on `signify-ts`. The vLEI Wallet
extension ([signify-browser-extension](https://github.com/GLEIF-IT/signify-browser-extension)) is a full
implementation: `src/pages/content/index.tsx` (bridge + sign-in dialog) and
`src/pages/background/handlers/protocol.ts` (router).

## Examples

| Example | What it shows | Run |
|---|---|---|
| [`docs/examples/web-app`](./docs/examples/web-app) | Minimal web app: detection, sign-in, session restore, signed request | `npm install && npm run dev` → http://localhost:5173 |
| [`docs/examples/demo-extension`](./docs/examples/demo-extension) | Demo wallet extension without KERIA: content bridge, in-page sign-in, sessions in the background | `npm install && npm run build`, load `dist` unpacked |

The web apps need a wallet extension in the browser: the demo extension, or the vLEI Wallet (build it, load
`dist/chrome` unpacked) connected to a KERIA agent.

## Extending the protocol

`ProtocolMap` is an interface, so a new message type is declared once and is then typed for the router's handlers
on the extension side:

```ts
// shared .d.ts, seen by both sides
declare module "vlei-wallet-protocol/protocol" {
  interface ProtocolMap {
    "/signify/acme/ping": { payload: { n: number }; extra: {}; result: { pong: number } };
  }
}
```

```ts
// background
import { createBackgroundRouter } from "vlei-wallet-protocol/extension";

createBackgroundRouter({ "/signify/acme/ping": ({ payload }) => ({ pong: payload.n + 1 }) });
```

```ts
// web app
import { createClient } from "vlei-wallet-protocol";

const client = createClient();
const { pong } = await client.sendMessage<{ payload: { n: number } }, { pong: number }>("/signify/acme/ping", {
  payload: { n: 1 },
});
```

The content bridge forwards every `/signify/*` request, so new `/signify/…` types need no bridge change. Types with
another prefix need a bridge change.

## Tests

```bash
npm test            # unit (jsdom): client, wallet functions, router, bridge, runtime glue
npm run test:live   # full chain against running KERIA; skipped if KERIA is unreachable
npm run test:e2e    # real Chromium + a real extension + e2e/e2e-testable-web-app + KERIA (see below)
npm run typecheck && npm run build
```

The live test boots a fresh KERIA agent with a random passcode and creates an AID. It then runs the wallet functions
through the client, a `postMessage` bridge, serialized runtime messaging and the router to real `signify-ts` handlers.
It covers handshake, `authorizeAid`, `restoreSession`, `signRequest` (headers verified with the AID's key),
`signData` (signatures verified), `issueCredentials`, `refetchCredentialCesr`, `switchIdentity` with a schema filter,
and a partly failed batch (`IssuanceFailure.issued`).

The credential schemas are generated by the tests and served from this machine. KERIA in Docker resolves them via
`http://host.docker.internal:<port>`. The `vlei-server` container does not serve the AAV/FAW schemas: it answers
`200` with an empty body, and KERIA 0.2.0-dev4 then **crashes**. Env: `KERIA_URL` (default `http://localhost:3901`),
`KERIA_BOOT_URL` (`http://localhost:3903`), `SCHEMA_OOBI_HOST` (`http://host.docker.internal`).

### End-to-end tests

`e2e/` drives `e2e/e2e-testable-web-app`, a test page that exercises every library call, in Playwright's Chromium
with a wallet extension you build yourself; nothing outside this repository is referenced or built.

```bash
npx playwright install chromium                 # once (branded Chrome no longer loads unpacked extensions)
npm --prefix e2e/e2e-testable-web-app install   # once
VLEI_EXTENSION_PATH=/path/to/extension/dist/chrome npm run test:e2e   # HEADED=1 to watch
```

A Node `signify-ts` harness boots a fresh agent, creates an AID, resolves two test schemas and issues two credentials
held by the AID. The extension is then connected to that agent and the suite checks, through the page: handshake on
injection and on request, no-session errors, sign-in via the in-page prompt (AID, credential, schema filter, one-time,
cancel), `restoreSession` after reload, `signRequest` and `signData` verified against the AID's key, issuance approved
and denied in the extension window, CESR refetch, invalid batches, unsupported types, `switchIdentity`, `clearSession`
and `configureVendor`.

Extension-specific steps (connecting it, offering sign-ins, clicking its prompts) live behind the `WalletDriver`
interface in `e2e/drivers/types.ts`. `e2e/drivers/vlei-wallet.ts` drives the vLEI Wallet; `VLEI_EXTENSION_DRIVER`
selects another driver.

## Notes

- `client.authorizeAutoSignin` is a reserved stub (**TODO** in the spec): it only sends its message, and the vLEI
  Wallet answers it as unsupported.
- The client keeps polaris-web's rule that a success reply carries an object payload; the bridge turns a missing
  payload into `{}`.
- Live tests run in Node with a minimal `window` (`test/live/setup.ts`). jsdom's typed arrays come from another
  realm, and libsodium rejects them.
- `isExtensionInstalled` answers once per client: after it resolves `false`, the same client keeps answering
  `false`. To check again (for example after the extension was installed), create a new client with
  `createClient()` or reload the page.

## License

Apache-2.0, see [LICENSE](./LICENSE). The web client (`src/web/client.ts`) is based on
[polaris-web](https://github.com/WebOfTrust/polaris-web) (Apache-2.0).
