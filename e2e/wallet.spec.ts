import { Authenticater, Siger, Verfer } from "signify-ts";
import { PROTOCOL_ERRORS } from "../src/protocol";
import { act, expect, outcome, test } from "./fixtures";

// The e2e-testable web app (e2e/e2e-testable-web-app) talks to a real wallet extension in Chromium, which
// talks to a real KERIA agent. Each step builds on the previous one's session, so the suite runs in order.
test.describe.configure({ mode: "serial" });

let issuedSaid: string;

const aidKey = async (harness: { client: any; aidName: string }) =>
  (await harness.client.identifiers().get(harness.aidName)).state.k[0] as string;

test("the extension answers the handshake, on injection and on request", async ({ app, extensionId }) => {
  await expect(app.getByTestId("status")).toHaveAttribute("data-extension-id", extensionId);
  // A client created long after the content script was injected: only the re-announcement can reach it.
  await app.getByTestId("status").evaluate((el) => el.removeAttribute("data-extension-id"));
  await app.getByTestId("btn-detect").click();
  await expect(app.getByTestId("status")).toHaveAttribute("data-extension-id", extensionId);
});

test("there is no session before signing in", async ({ app }) => {
  expect(await outcome(app, "session")).toEqual({ ok: true, result: null });
  const signed = await act(app, "btn-sign-request", "sign-request-result");
  expect(signed).toMatchObject({ ok: false, error: PROTOCOL_ERRORS.sessionNotFound });
});

test("closing the sign-in prompt rejects the request as cancelled", async ({ app, driver }) => {
  await app.getByTestId("btn-aid").click();
  expect(await driver.promptedChoices(app)).toBe(1);
  await driver.cancelSignin(app);
  expect(await outcome(app, "session")).toMatchObject({ ok: false, error: PROTOCOL_ERRORS.cancelled });
});

test("signing in with the AID starts a session", async ({ app, driver, harness }) => {
  await app.getByTestId("btn-aid").click();
  expect(await driver.promptedChoices(app)).toBe(1); // the AID only, no credentials
  await driver.pickSignin(app, 0);
  const { ok, result } = await outcome(app, "session");
  expect(ok).toBe(true);
  expect(result.identifier).toMatchObject({ prefix: harness.aidPrefix, name: harness.aidName });
  expect(result.expiry).toBeGreaterThan(Date.now());
  expect(result.headers).toBeUndefined();
});

test("the session survives a page reload (restoreSession)", async ({ app, harness }) => {
  await app.reload();
  const { ok, result } = await outcome(app, "session");
  expect(ok).toBe(true);
  expect(result.identifier.prefix).toBe(harness.aidPrefix);
});

test("signRequest returns KERI headers that verify against the AID's key", async ({ app, harness }) => {
  const url = `${new URL(app.url()).origin}/api/reports?year=2026`;
  await app.getByTestId("sign-url").fill(url);
  await app.getByTestId("sign-method").selectOption("POST");
  const { ok, result } = await act(app, "btn-sign-request", "sign-request-result");
  expect(ok).toBe(true);
  expect(result.headers["signify-resource"]).toBe(harness.aidPrefix);

  const verifier = new Authenticater(null as any, new Verfer({ qb64: await aidKey(harness) }));
  const path = new URL(url).pathname;
  expect(verifier.verify(new Headers(result.headers), "POST", path)).toBe(true);
  expect(() => verifier.verify(new Headers(result.headers), "GET", path)).toThrow(/invalid/);
});

test("signData signatures verify against the AID's key", async ({ app, harness }) => {
  await app.getByTestId("sign-data-items").fill("hello\nvLEI wallet");
  const { ok, result } = await act(app, "btn-sign-data", "sign-data-result");
  expect(ok).toBe(true);
  expect(result.aid).toBe(harness.aidPrefix);
  expect(result.items.map((item: any) => item.data)).toEqual(["hello", "vLEI wallet"]);
  const verfer = new Verfer({ qb64: await aidKey(harness) });
  for (const item of result.items) {
    expect(verfer.verify(new Siger({ qb64: item.signature }).raw, new TextEncoder().encode(item.data))).toBe(true);
  }
});

test("one-time sign-in returns signed headers and no session", async ({ app, driver, harness }) => {
  await app.getByTestId("one-time").check();
  await app.getByTestId("btn-aid").click();
  await driver.promptedChoices(app);
  await driver.pickSignin(app, 0);
  const { ok, result } = await outcome(app, "session");
  await app.getByTestId("one-time").uncheck();
  expect(ok).toBe(true);
  expect(result.headers["signify-resource"]).toBe(harness.aidPrefix);
  expect(result.expiry).toBeUndefined();
});

test("credential sign-in offers only credentials, filtered by schema", async ({ app, driver, harness }) => {
  await app.getByTestId("btn-cred").click();
  expect(await driver.promptedChoices(app)).toBe(2); // both held credentials, not the AID
  await driver.cancelSignin(app);
  await outcome(app, "session");

  await app.getByTestId("schema-filter").fill(harness.holderSchema);
  await app.getByTestId("btn-cred").click();
  expect(await driver.promptedChoices(app)).toBe(1);
  await driver.pickSignin(app, 0);
  const { ok, result } = await outcome(app, "session");
  await app.getByTestId("schema-filter").fill("");

  const held = harness.heldCredentials.holder.sad;
  expect(ok).toBe(true);
  expect(result.credential.raw.sad).toMatchObject({ d: held.d, s: harness.holderSchema });
  expect(result.credential.cesr).toContain(held.d);
  expect(result.expiry).toBeGreaterThan(Date.now());
});

test("issueCredentials issues after the user approves in the extension", async ({ app, driver, harness }) => {
  await app.getByTestId("issue-schema").fill(harness.issueSchema);
  await app.getByTestId("issue-registry").fill("e2e-issued");
  await app.getByTestId("issue-attributes").fill(JSON.stringify(harness.issueAttributes("approved.pdf")));
  const approved = driver.answerIssuance("approve");
  await app.getByTestId("btn-issue").click();
  await approved;

  const { ok, result } = await outcome(app, "issue-result");
  expect(ok).toBe(true);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ schemaSaid: harness.issueSchema, registryName: "e2e-issued", issuer: harness.aidPrefix });
  issuedSaid = result[0].said;
  expect((await harness.client.credentials().get(issuedSaid)).sad.d).toBe(issuedSaid);
});

test("refetchCredentialCesr returns the issued credential's CESR", async ({ app, harness }) => {
  await app.getByTestId("cesr-said").fill(issuedSaid);
  const { ok, result } = await act(app, "btn-cesr", "cesr-result");
  expect(ok).toBe(true);
  expect(result).toContain(issuedSaid);
  expect(result).toContain(harness.issueSchema);
});

test("denied issuance rejects with 'User rejected' and nothing issued", async ({ app, driver, harness }) => {
  await app.getByTestId("issue-attributes").fill(JSON.stringify(harness.issueAttributes("denied.pdf")));
  const denied = driver.answerIssuance("deny");
  await app.getByTestId("btn-issue").click();
  await denied;
  expect(await outcome(app, "issue-result")).toEqual({ ok: false, error: PROTOCOL_ERRORS.userRejected, issued: [] });
});

test("an invalid issuance request fails before any approval window", async ({ app, driver }) => {
  await app.getByTestId("issue-attributes").fill(JSON.stringify({ i: "EAnyone", filename: "x.pdf" }));
  const { ok, error, issued } = await act(app, "btn-issue", "issue-result");
  expect(ok).toBe(false);
  expect(error).toContain('must not contain "d" or "i"');
  expect(issued).toEqual([]);
  expect(driver.openIssuancePrompts()).toBe(0);
});

test("message types the extension does not support get an error reply", async ({ app }) => {
  await app.getByTestId("raw-type").fill("/signify/authorize-auto-signin");
  await app.getByTestId("raw-payload").fill("{}");
  expect(await act(app, "btn-raw", "raw-result")).toEqual({
    ok: false,
    error: PROTOCOL_ERRORS.unsupported("/signify/authorize-auto-signin"),
  });
});

test("switchIdentity ends the session and signs in again", async ({ app, driver, harness }) => {
  await app.getByTestId("btn-switch").click();
  expect(await driver.promptedChoices(app)).toBe(2);
  await driver.pickSignin(app, 1);
  const { ok, result } = await outcome(app, "session");
  expect(ok).toBe(true);
  expect(result.credential.raw.sad.d).toBe(harness.heldCredentials.issue.sad.d);
});

test("clearSession ends the session", async ({ app }) => {
  expect(await act(app, "btn-clear", "session")).toEqual({ ok: true, result: null });
  const signed = await act(app, "btn-sign-request", "sign-request-result");
  expect(signed).toMatchObject({ ok: false, error: PROTOCOL_ERRORS.sessionNotFound });
});

// Last: a pending vendor change makes the extension's popup ask the user to confirm it.
test("configureVendor is acknowledged with an empty reply", async ({ app }) => {
  await app.getByTestId("raw-type").fill("/signify/configure-vendor");
  await app.getByTestId("raw-payload").fill(JSON.stringify({ url: "https://vendor.example/vendor.json" }));
  expect(await act(app, "btn-raw", "raw-result")).toEqual({ ok: true, result: {} });
});
