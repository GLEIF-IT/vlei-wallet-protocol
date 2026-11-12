/**
 * jsdom's window.postMessage drops messages sent to targetOrigin "/" and never sets `event.source`.
 * Browsers do both, and the protocol relies on them, so tests use a same-window postMessage that
 * behaves like a browser: async delivery, structured clone, `source === window`, page origin.
 */
if (typeof window !== "undefined") {
  window.postMessage = ((message: unknown) => {
    const data = structuredClone(message);
    setTimeout(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data, source: window, origin: window.location.origin })
      );
    }, 0);
  }) as typeof window.postMessage;
}
