import {
  createBackgroundRouter,
  createRuntimeListener,
  HandlerError,
  PROTOCOL_ERRORS,
  type AuthorizeResult,
} from "vlei-wallet-protocol/extension";

// Not a real identifier: the demo wallet keeps no keys and signs nothing.
const DEMO_AID = "EDemo_not_a_real_identifier";

// Sessions per tab and site. They live in memory while the service worker runs.
const sessions = new Map<string, AuthorizeResult>();

const router = createBackgroundRouter({
  "/signify/authorize/credential": (_request, { tabId, origin }) => {
    const session = { identifier: { prefix: DEMO_AID, name: "demo" }, expiry: Date.now() + 30 * 60_000 };
    sessions.set(`${tabId} ${origin}`, session);
    return session;
  },
  "/signify/get-session-info": (_request, { tabId, origin }) => {
    const session = sessions.get(`${tabId} ${origin}`);
    if (!session) throw new HandlerError(PROTOCOL_ERRORS.sessionNotFound);
    return session;
  },
});

// Accepts requests from content.ts. Other message types get the reply "Unsupported message type".
const listener = createRuntimeListener(router, chrome.runtime.id, { requireActiveTab: true });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const response = listener(message, sender);
  if (!response) return false;
  response.then(sendResponse);
  return true; // the reply arrives asynchronously
});
