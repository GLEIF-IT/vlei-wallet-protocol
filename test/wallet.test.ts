import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HandlerError, type IssuedCredential, type ProtocolHandlers } from "../src/extension";
import { startFakeExtension } from "./helpers/fake-extension";

type Wallet = typeof import("../src");
let wallet: Wallet;
let bridge: { dispose(): void } | undefined;

// Each test gets a fresh module, so the wallet's lazily created default client is new too.
beforeEach(async () => {
  vi.resetModules();
  wallet = await import("../src");
});
afterEach(() => bridge?.dispose());

const withExtension = (handlers: Partial<ProtocolHandlers>) => {
  bridge = startFakeExtension(handlers);
};

const issued: IssuedCredential = {
  said: "ECred1",
  schemaSaid: "ESchema",
  registryName: "reg",
  issuer: "EAid",
  issuedAt: "2026-01-01T00:00:00.000000+00:00",
};

describe("wallet functions", () => {
  it("restoreSession returns null when there is no session or the call fails", async () => {
    withExtension({
      "/signify/get-session-info": () => {
        throw new HandlerError("Session not found");
      },
    });
    expect(await wallet.restoreSession()).toBeNull();
  });

  it("restoreSession returns null for an empty session", async () => {
    withExtension({ "/signify/get-session-info": () => ({}) });
    expect(await wallet.restoreSession()).toBeNull();
  });

  it("switchIdentity ignores a clear-session failure and re-authorizes", async () => {
    const clear = vi.fn(() => {
      throw new Error("clear failed");
    });
    withExtension({
      "/signify/clear-session": clear,
      "/signify/authorize/credential": () => ({ identifier: { prefix: "ENew" } }),
    });
    const result = await wallet.switchIdentity({ message: "again" });
    expect(clear).toHaveBeenCalledOnce();
    expect(result.identifier?.prefix).toBe("ENew");
  });

  it("issueCredentials returns the issued list on success", async () => {
    withExtension({ "/signify/credential/issue": () => ({ credentials: [issued] }) });
    const result = await wallet.issueCredentials([
      { schemaSaid: "ESchema", registryName: "reg", attributes: { a: 1 } },
    ]);
    expect(result).toEqual([issued]);
  });

  it("issueCredentials rejects with IssuanceFailure carrying the partially issued credentials", async () => {
    withExtension({
      "/signify/credential/issue": () => {
        throw new HandlerError("second one failed", { issued: [issued] });
      },
    });
    const error = await wallet
      .issueCredentials([{ schemaSaid: "ESchema", registryName: "reg", attributes: {} }])
      .catch((e) => e);
    expect(error).toBeInstanceOf(wallet.IssuanceFailure);
    expect(error.message).toBe("second one failed");
    expect(error.issued).toEqual([issued]);
  });

  it("issueCredentials reports issued = [] when the user rejects", async () => {
    withExtension({
      "/signify/credential/issue": () => {
        throw new HandlerError("User rejected");
      },
    });
    const error = await wallet.issueCredentials([]).catch((e) => e);
    expect(error).toBeInstanceOf(wallet.IssuanceFailure);
    expect(error.issued).toEqual([]);
  });

  it("refetchCredentialCesr accepts a CESR string or { cesr } and throws otherwise", async () => {
    const replies: unknown[] = ["-cesr-string", { cesr: "-cesr-object" }, { sad: {} }];
    withExtension({ "/signify/credential/get": () => ({ credential: replies.shift() }) });
    expect(await wallet.refetchCredentialCesr("ECred")).toBe("-cesr-string");
    expect(await wallet.refetchCredentialCesr("ECred")).toBe("-cesr-object");
    await expect(wallet.refetchCredentialCesr("ECred")).rejects.toThrow(/did not return a CESR/);
  });

  it("signRequest sends url + method and returns the headers", async () => {
    withExtension({
      "/signify/sign-request": ({ payload }) => ({ headers: { "Signify-Resource": `${payload.method} ${payload.url}` } }),
    });
    expect(await wallet.signRequest("https://api.test/x", "POST")).toEqual({
      "Signify-Resource": "POST https://api.test/x",
    });
  });
});
