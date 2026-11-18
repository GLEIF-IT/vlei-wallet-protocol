import {
  createContentBridge,
  forwardViaRuntime,
  HandlerError,
  PROTOCOL_ERRORS,
  type AuthorizeResult,
} from "vlei-wallet-protocol/extension";

// Passes a page request to background.ts and returns its reply.
const forward = forwardViaRuntime((envelope) => chrome.runtime.sendMessage(envelope));

createContentBridge({
  extensionId: chrome.runtime.id,
  forward,
  local: {
    // We ask about the sign-in right on the page, and background creates the session.
    "/signify/authorize/credential": async (request) => {
      if (!confirm(`Demo wallet: sign in to ${location.origin}?\n\n${request.payload?.message ?? ""}`)) {
        throw new HandlerError(PROTOCOL_ERRORS.cancelled);
      }
      return (await forward(request)) as AuthorizeResult;
    },
  },
});
