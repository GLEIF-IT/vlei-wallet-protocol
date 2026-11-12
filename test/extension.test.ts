import { afterEach, describe, expect, it } from "vitest";
import {
  HandlerError,
  PROTOCOL_ERRORS,
  REPLY_TYPE,
  contextFromSender,
  createBackgroundRouter,
  createRuntimeListener,
} from "../src/extension";
import { createClient } from "../src";
import { createContentBridge } from "../src/extension";
import { EXTENSION_ID, recordWindowMessages, startFakeExtension, tick } from "./helpers/fake-extension";

const ctx = { origin: "https://app.test", tabId: 1, requestId: "r1" };
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

describe("background router", () => {
  it("passes payload, extra fields and context to the handler", async () => {
    const router = createBackgroundRouter({
      "/signify/authorize": (request, context) => ({ identifier: { prefix: `${request.schema}@${context.origin}` } }),
    });
    const response = await router.handle(
      { type: "/signify/authorize", requestId: "r1", payload: {}, schema: "ES" },
      ctx
    );
    expect(response).toEqual({ ok: true, payload: { identifier: { prefix: "ES@https://app.test" } } });
  });

  it("turns HandlerError into an error response with payload", async () => {
    const router = createBackgroundRouter({
      "/signify/credential/issue": () => {
        throw new HandlerError("failed", { issued: [] });
      },
    });
    const response = await router.handle(
      { type: "/signify/credential/issue", requestId: "r1", payload: { credentials: [] } },
      ctx
    );
    expect(response).toEqual({ ok: false, error: "failed", payload: { issued: [] } });
  });

  it("answers unsupported message types with an error and void handlers with {}", async () => {
    const router = createBackgroundRouter({ "/signify/clear-session": () => undefined });
    expect(await router.handle({ type: "/signify/sign-data", requestId: "r1" } as any, ctx)).toEqual({
      ok: false,
      error: PROTOCOL_ERRORS.unsupported("/signify/sign-data"),
    });
    expect(await router.handle({ type: "/signify/clear-session", requestId: "r1" }, ctx)).toEqual({
      ok: true,
      payload: {},
    });
  });

  it("runtime listener ignores foreign messages and senders, takes context from the sender", async () => {
    const router = createBackgroundRouter({ "/signify/get-session-info": (_r, c) => ({ identifier: { prefix: c.origin } }) });
    const listener = createRuntimeListener(router, "ext");
    const envelope = { channel: "vlei-wallet-protocol", message: { type: "/signify/get-session-info", requestId: "r" } };
    expect(listener({ type: "cs-other" }, { id: "ext" })).toBeUndefined();
    expect(listener(envelope, { id: "someone-else", tab: { id: 1 }, url: "https://a.test/x" })).toBeUndefined();
    expect(await listener(envelope, { id: "ext", tab: { id: 1 }, url: "https://a.test/page?q=1" })).toEqual({
      ok: true,
      payload: { identifier: { prefix: "https://a.test" } },
    });
    expect(() => contextFromSender({ id: "ext" }, "r")).toThrow(HandlerError);
  });

  it("runtime listener with requireActiveTab answers background tabs with an error", async () => {
    const router = createBackgroundRouter({ "/signify/clear-session": () => undefined });
    const listener = createRuntimeListener(router, "ext", { requireActiveTab: true });
    const envelope = { channel: "vlei-wallet-protocol", message: { type: "/signify/clear-session", requestId: "r" } };
    const tab = (active?: boolean) => ({ id: "ext", url: "https://a.test/", tab: { id: 1, active } });
    expect(await listener(envelope, tab(false))).toEqual({ ok: false, error: PROTOCOL_ERRORS.notActiveTab });
    expect(await listener(envelope, tab(undefined))).toEqual({ ok: false, error: PROTOCOL_ERRORS.notActiveTab });
    expect(await listener(envelope, tab(true))).toEqual({ ok: true, payload: {} });
  });
});

describe("content bridge", () => {
  it("posts exactly one reply per request, including unsupported types", async () => {
    const wire = recordWindowMessages();
    cleanups.push(wire.stop);
    const bridge = startFakeExtension({ "/signify/clear-session": () => undefined });
    const client = createClient();
    cleanups.push(() => bridge.dispose(), () => client.dispose());

    await expect(client.clearSession()).resolves.toEqual({});
    await expect(client.signData({ items: ["x"] })).rejects.toThrow(PROTOCOL_ERRORS.unsupported("/signify/sign-data"));
    await tick();

    const replies = wire.seen.filter((m) => m.type === REPLY_TYPE);
    const requests = wire.seen.filter((m) => m.type?.startsWith("/signify/") && m.type !== REPLY_TYPE);
    expect(requests).toHaveLength(2);
    expect(replies).toHaveLength(2);
    expect(new Set(replies.map((r) => r.requestId))).toEqual(new Set(requests.map((r) => r.requestId)));
  });

  it("ignores non-protocol page messages", async () => {
    const wire = recordWindowMessages();
    cleanups.push(wire.stop);
    const bridge = startFakeExtension({});
    cleanups.push(() => bridge.dispose());
    window.postMessage({ type: "some-other-lib", requestId: "x" }, "*");
    window.postMessage({ type: "/signify/authorize" }, "*"); // no requestId
    await tick(50);
    expect(wire.seen.filter((m) => m.type === REPLY_TYPE)).toHaveLength(0);
  });

  it("answers local message types in the content script, without the background", async () => {
    const forwarded: string[] = [];
    const bridge = createContentBridge({
      extensionId: EXTENSION_ID,
      forward: async (message) => {
        forwarded.push(message.type);
        return {};
      },
      local: {
        "/signify/authorize/aid": async (request) => ({ identifier: { prefix: `picked:${request.payload?.message}` } }),
        "/signify/authorize/credential": () => {
          throw new HandlerError(PROTOCOL_ERRORS.cancelled, { reason: "closed" });
        },
      },
    });
    const client = createClient();
    cleanups.push(() => bridge.dispose(), () => client.dispose());

    await expect(client.authorizeAid({ message: "hi" })).resolves.toEqual({ identifier: { prefix: "picked:hi" } });
    const error = await client.authorizeCred().catch((e) => e);
    expect(error.message).toBe(PROTOCOL_ERRORS.cancelled);
    expect(error.payload).toEqual({ reason: "closed" });
    await expect(client.clearSession()).resolves.toEqual({});
    expect(forwarded).toEqual(["/signify/clear-session"]);
  });
});
