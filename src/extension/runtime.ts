import { PROTOCOL_ERRORS } from "../protocol/constants.js";
import { HandlerError } from "../protocol/errors.js";
import type { RequestEnvelope } from "../protocol/messages.js";
import type { BackgroundRouter, RequestContext, RouterResponse } from "./router.js";

// Glue between the content script and the background over `runtime.sendMessage`.
// Structural types only, so it works with `chrome.*`, `browser.*` and webextension-polyfill.

/** Tag that marks protocol traffic among the extension's other runtime messages. */
export const RUNTIME_CHANNEL = "vlei-wallet-protocol";

export interface RuntimeEnvelope {
  channel: typeof RUNTIME_CHANNEL;
  message: RequestEnvelope;
}

/** The subset of `runtime.MessageSender` the protocol needs. */
export interface RuntimeSender {
  id?: string;
  origin?: string;
  url?: string;
  tab?: { id?: number; url?: string; active?: boolean };
}

export function wrapForRuntime(message: RequestEnvelope): RuntimeEnvelope {
  return { channel: RUNTIME_CHANNEL, message };
}

export function isRuntimeEnvelope(value: unknown): value is RuntimeEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as RuntimeEnvelope).channel === RUNTIME_CHANNEL &&
    typeof (value as RuntimeEnvelope).message === "object"
  );
}

/** Turns a `RouterResponse` back into a payload, or throws `HandlerError` (keeping `payload`). */
export function unwrapRouterResponse(response: RouterResponse | undefined): object {
  if (!response) throw new HandlerError(PROTOCOL_ERRORS.noBackgroundResponse);
  if (response.ok) return response.payload;
  throw new HandlerError(response.error, response.payload);
}

/**
 * Builds the bridge's `forward` from a `runtime.sendMessage`-like function.
 *
 * ```ts
 * createContentBridge({ extensionId: chrome.runtime.id, forward: forwardViaRuntime(chrome.runtime.sendMessage) });
 * ```
 */
export function forwardViaRuntime(
  sendMessage: (envelope: RuntimeEnvelope) => Promise<unknown>
): (message: RequestEnvelope) => Promise<object> {
  return async (message) => unwrapRouterResponse((await sendMessage(wrapForRuntime(message))) as RouterResponse);
}

/** Request context from the browser-provided sender. Throws if the sender is not a tab. */
export function contextFromSender(sender: RuntimeSender, requestId: string): RequestContext {
  const tabId = sender.tab?.id;
  const url = sender.origin ?? sender.url ?? sender.tab?.url;
  if (typeof tabId !== "number" || !url) throw new HandlerError(PROTOCOL_ERRORS.notFromTab);
  return { origin: new URL(url).origin, tabId, requestId };
}

export interface RuntimeListenerOptions {
  /**
   * Answer only the browser window's active tab; requests from background tabs get an error reply
   * (`PROTOCOL_ERRORS.notActiveTab`). Needs `sender.tab.active`, which Chrome and Firefox provide.
   */
  requireActiveTab?: boolean;
}

/**
 * Background listener for `runtime.onMessage`. Returns a promise for protocol messages from this
 * extension's own content scripts and `undefined` for everything else (so other listeners can answer).
 *
 * ```ts
 * chrome.runtime.onMessage.addListener(createRuntimeListener(router, chrome.runtime.id));
 * ```
 * With raw `chrome.*` (no polyfill) wrap it to call `sendResponse` and return `true`.
 */
export function createRuntimeListener(
  router: BackgroundRouter,
  extensionId?: string,
  options: RuntimeListenerOptions = {}
) {
  return (message: unknown, sender: RuntimeSender): Promise<RouterResponse> | undefined => {
    if (!isRuntimeEnvelope(message)) return undefined;
    if (extensionId !== undefined && sender.id !== extensionId) return undefined;
    let context: RequestContext;
    try {
      context = contextFromSender(sender, message.message.requestId);
    } catch (error) {
      return Promise.resolve({ ok: false, error: (error as Error).message });
    }
    if (options.requireActiveTab && sender.tab?.active !== true) {
      return Promise.resolve({ ok: false, error: PROTOCOL_ERRORS.notActiveTab });
    }
    return router.handle(message.message, context);
  };
}
