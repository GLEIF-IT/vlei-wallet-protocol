import { HANDSHAKE, REPLY_TYPE } from "../protocol/constants.js";
import { HandlerError } from "../protocol/errors.js";
import {
  isHandshakeClient,
  isProtocolRequest,
  type MessageType,
  type ReplyEnvelope,
  type RequestEnvelope,
  type ResultOf,
} from "../protocol/messages.js";

/**
 * A request answered inside the content script, e.g. a sign-in prompt rendered in the page.
 * Resolve with the reply payload; throw (ideally `HandlerError`) to send an error reply.
 */
export type LocalHandler<T extends MessageType> = (request: RequestEnvelope<T>) => Promise<ResultOf<T>> | ResultOf<T>;

/** Content-script handlers by message type. */
export type LocalHandlers = { [T in MessageType]?: LocalHandler<T> };

export interface ExtensionBridgeOptions {
  /** This extension's ID, announced in the handshake. */
  extensionId: string;
  /**
   * Delivers a request to the background and resolves with the reply payload. Reject (ideally with a
   * `HandlerError`, which keeps `payload`) to send an error reply. See `forwardViaRuntime`.
   */
  forward(message: RequestEnvelope): Promise<unknown>;
  /**
   * Message types answered in the content script instead of the background, e.g. `authorize*` prompts
   * shown in the page. Every other request goes to `forward`.
   */
  local?: LocalHandlers;
  /** Window to listen on. Default: the global `window`. */
  window?: Window;
  /** `targetOrigin` for replies. Default: the page's own origin. */
  targetOrigin?: string;
}

export interface ExtensionBridge {
  dispose(): void;
}

/**
 * Content-script side: answers the handshake and relays page requests to `local` handlers or the
 * background, posting exactly one `/signify/reply` per request.
 */
export function createContentBridge(options: ExtensionBridgeOptions): ExtensionBridge {
  const win = options.window ?? window;
  const targetOrigin = () => options.targetOrigin ?? win.location.origin;
  const post = (message: object) => win.postMessage(message, targetOrigin());
  const announce = () => post({ type: HANDSHAKE.extension, data: { extensionId: options.extensionId } });
  const local = (options.local ?? {}) as Record<string, ((request: RequestEnvelope) => unknown) | undefined>;

  const onMessage = async (event: MessageEvent) => {
    if (event.source !== win) return;
    const data = event.data;

    if (isHandshakeClient(data)) {
      announce();
      return;
    }
    if (!isProtocolRequest(data)) return;

    let reply: ReplyEnvelope;
    try {
      const handler = local[data.type];
      const payload = typeof handler === "function" ? await handler(data) : await options.forward(data);
      reply = {
        type: REPLY_TYPE,
        requestId: data.requestId,
        payload: payload && typeof payload === "object" ? payload : {},
      };
    } catch (error) {
      const payload = error instanceof HandlerError ? error.payload : undefined;
      reply = {
        type: REPLY_TYPE,
        requestId: data.requestId,
        error: error instanceof Error ? error.message : String(error),
        ...(payload === undefined ? {} : { payload }),
      };
    }
    post(reply);
  };

  win.addEventListener("message", onMessage, false);
  announce(); // trigger 1: content script injected; trigger 2 is the `signify-extension-client` reply above

  return {
    dispose: () => win.removeEventListener("message", onMessage, false),
  };
}
