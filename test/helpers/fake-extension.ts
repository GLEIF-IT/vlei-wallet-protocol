import {
  createBackgroundRouter,
  createContentBridge,
  forwardViaRuntime,
  createRuntimeListener,
  type ProtocolHandlers,
  type RuntimeEnvelope,
} from "../../src/extension";

export const EXTENSION_ID = "test-extension-id";

/**
 * An in-page "extension": content-script bridge → simulated runtime messaging (JSON round trip,
 * like the browser's serialization) → background router with the given handlers.
 */
export function startFakeExtension(handlers: Partial<ProtocolHandlers>) {
  const router = createBackgroundRouter(handlers);
  const listener = createRuntimeListener(router, EXTENSION_ID);
  const sender = { id: EXTENSION_ID, origin: window.location.origin, tab: { id: 7 } };
  const sendMessage = async (envelope: RuntimeEnvelope) =>
    JSON.parse(JSON.stringify(await listener(JSON.parse(JSON.stringify(envelope)), sender)));
  return createContentBridge({ extensionId: EXTENSION_ID, forward: forwardViaRuntime(sendMessage) });
}

/** Collects every message posted on the window (for asserting what went over the wire). */
export function recordWindowMessages() {
  const seen: any[] = [];
  const onMessage = (event: MessageEvent) => seen.push(event.data);
  window.addEventListener("message", onMessage);
  return { seen, stop: () => window.removeEventListener("message", onMessage) };
}

export const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
