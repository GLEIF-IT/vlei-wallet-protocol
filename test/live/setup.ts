// The live tests run in Node, not jsdom: jsdom's typed arrays come from another realm and libsodium
// (inside signify-ts) rejects them. The protocol only needs a same-window postMessage, so a minimal
// browser-like `window` is enough.
const origin = "http://localhost:3000";
const win = new EventTarget() as EventTarget & Record<string, unknown>;

Object.assign(win, {
  location: { origin, href: `${origin}/` },
  crypto: globalThis.crypto,
  postMessage(message: unknown) {
    const data = structuredClone(message);
    setTimeout(() => {
      // Node's MessageEvent only accepts a MessagePort as `source`, so build the event by hand.
      const event = new Event("message");
      Object.defineProperties(event, {
        data: { value: data },
        origin: { value: origin },
        source: { value: win },
      });
      win.dispatchEvent(event);
    }, 0);
  },
});

Object.assign(globalThis, { window: win });

export {};
