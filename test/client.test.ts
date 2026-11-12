import { afterEach, describe, expect, it } from "vitest";
import { createClient, HANDSHAKE, REPLY_TYPE, type ExtensionClient } from "../src";
import { EXTENSION_ID, recordWindowMessages, startFakeExtension, tick } from "./helpers/fake-extension";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));
const track = <T extends { dispose(): void }>(x: T) => (cleanups.push(() => x.dispose()), x);

describe("ExtensionClient", () => {
  it("handshake works when the extension starts before the client", async () => {
    track(startFakeExtension({}));
    await tick();
    const client: ExtensionClient = track(createClient());
    expect(await client.isExtensionInstalled(500)).toBe(EXTENSION_ID);
  });

  it("handshake works when the client is created before the extension", async () => {
    const client = track(createClient());
    await tick();
    track(startFakeExtension({}));
    expect(await client.isExtensionInstalled(500)).toBe(EXTENSION_ID);
  });

  it("isExtensionInstalled resolves false when nobody answers", async () => {
    const client = track(createClient());
    expect(await client.isExtensionInstalled(50)).toBe(false);
  });

  it("sends schema at the top level and resolves with the reply payload", async () => {
    const wire = recordWindowMessages();
    cleanups.push(wire.stop);
    track(
      startFakeExtension({
        "/signify/authorize/credential": ({ payload, schema }) => ({
          identifier: { prefix: `aid-for-${schema}` },
          credential: { raw: payload, cesr: "cesr" },
        }),
      })
    );
    const client = track(createClient());
    const result = await client.authorizeCred({ message: "pick one", schema: "ESchema" });

    expect(result.identifier?.prefix).toBe("aid-for-ESchema");
    expect(result.credential?.raw).toEqual({ message: "pick one" });
    const request = wire.seen.find((m) => m.type === "/signify/authorize/credential");
    expect(request).toMatchObject({ schema: "ESchema", payload: { message: "pick one" } });
    expect(request.payload.schema).toBeUndefined();
  });

  it("rejects with an Error that keeps the error reply's payload", async () => {
    const client = track(createClient());
    const pending = client.sendMessage("/signify/credential/issue", { payload: { credentials: [] } });
    const { requestId } = await new Promise<any>((resolve) =>
      window.addEventListener("message", function h(e) {
        if (e.data?.type === "/signify/credential/issue") {
          window.removeEventListener("message", h);
          resolve(e.data);
        }
      })
    );
    window.postMessage({ type: REPLY_TYPE, requestId, error: "boom", payload: { issued: [1] } }, "/");
    await expect(pending).rejects.toMatchObject({ message: "boom", payload: { issued: [1] } });
  });

  it("ignores messages from other windows and messages without a string type", async () => {
    const client = track(createClient());
    const pending = client.getSessionInfo();
    const { requestId } = await new Promise<any>((resolve) =>
      window.addEventListener("message", function h(e) {
        if (e.data?.type === "/signify/get-session-info") {
          window.removeEventListener("message", h);
          resolve(e.data);
        }
      })
    );
    // foreign source
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: REPLY_TYPE, requestId, error: "evil" }, source: null })
    );
    window.dispatchEvent(new MessageEvent("message", { data: { requestId, error: "no type" }, source: window }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: HANDSHAKE.extension }, source: window }));
    window.postMessage({ type: REPLY_TYPE, requestId, payload: { identifier: { prefix: "ok" } } }, "/");
    await expect(pending).resolves.toEqual({ identifier: { prefix: "ok" } });
  });
});
