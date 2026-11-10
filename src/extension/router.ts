import { PROTOCOL_ERRORS } from "../protocol/constants.js";
import { HandlerError } from "../protocol/errors.js";
import type { ExtraOf, MessageType, PayloadOf, RequestEnvelope, ResultOf } from "../protocol/messages.js";

/** Request facts taken from the browser (the runtime `sender`), never from the message. */
export interface RequestContext {
  origin: string;
  tabId: number;
  requestId: string;
}

export type ProtocolHandler<T extends MessageType> = (
  request: { payload: PayloadOf<T> } & ExtraOf<T>,
  context: RequestContext
) => Promise<ResultOf<T> | void> | ResultOf<T> | void;

/** One handler per message type, implemented in the background. */
export type ProtocolHandlers = { [T in MessageType]: ProtocolHandler<T> };

/**
 * What the background sends back to the content script. Plain data, so it survives
 * `runtime.sendMessage` serialization (an `Error` would not).
 */
export type RouterResponse =
  | { ok: true; payload: object }
  | { ok: false; error: string; payload?: object };

export interface BackgroundRouter {
  /** Runs the handler for `message.type`. Never throws: failures become `{ ok: false }`. */
  handle(message: RequestEnvelope, context: RequestContext): Promise<RouterResponse>;
  supports(type: string): boolean;
}

export interface BackgroundRouterOptions {
  /** Called for every failed request (logging). */
  onError?: (error: unknown, message: RequestEnvelope, context: RequestContext) => void;
}

/**
 * Background side: dispatches page requests to typed handlers. Register only the message types the
 * extension supports; the rest get an "Unsupported message type" error reply.
 * A handler that returns nothing replies `{}`.
 */
export function createBackgroundRouter(
  handlers: Partial<ProtocolHandlers>,
  options: BackgroundRouterOptions = {}
): BackgroundRouter {
  const table = handlers as Record<string, ProtocolHandler<MessageType> | undefined>;

  return {
    supports: (type) => typeof table[type] === "function",

    async handle(message, context) {
      const handler = table[message.type];
      if (typeof handler !== "function") {
        return { ok: false, error: PROTOCOL_ERRORS.unsupported(String(message.type)) };
      }
      try {
        const { type: _type, requestId: _requestId, ...request } = message;
        const result = await handler(request as Parameters<typeof handler>[0], context);
        return { ok: true, payload: result && typeof result === "object" ? result : {} };
      } catch (error) {
        options.onError?.(error, message, context);
        if (error instanceof HandlerError) {
          return error.payload === undefined
            ? { ok: false, error: error.message }
            : { ok: false, error: error.message, payload: error.payload };
        }
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
