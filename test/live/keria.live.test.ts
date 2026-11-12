import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Authenticater, Diger, MtrDex, SignifyClient, Siger, Tier, Verfer, randomPasscode, ready } from "signify-ts";
import { createClient, IssuanceFailure, type ExtensionClient } from "../../src";
import {
  createBackgroundRouter,
  createContentBridge,
  createRuntimeListener,
  forwardViaRuntime,
  type ExtensionBridge,
  type RuntimeEnvelope,
} from "../../src/extension";
import { createReferenceHandlers, waitOperation } from "./reference-handlers";
import { makeTestSchema, serveSchema } from "./schema-server";

// Full chain against the running containers:
//   wallet functions → ExtensionClient → window.postMessage → content bridge → runtime (JSON) → router → KERIA
// Env: KERIA_URL (default http://localhost:3901), KERIA_BOOT_URL (http://localhost:3903),
//      SCHEMA_OOBI_HOST (http://host.docker.internal — how KERIA in Docker reaches this machine).
// The credential schema is generated and served by the test itself (see schema-server.ts).
const KERIA_URL = process.env.KERIA_URL ?? "http://localhost:3901";
const KERIA_BOOT_URL = process.env.KERIA_BOOT_URL ?? "http://localhost:3903";
const SCHEMA_OOBI_HOST = process.env.SCHEMA_OOBI_HOST ?? "http://host.docker.internal";
const { said: TEST_SCHEMA, body: SCHEMA_BODY } = makeTestSchema();
const UNKNOWN_SCHEMA = "EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const EXTENSION_ID = "live-test-extension";

const keriaUp = await fetch(KERIA_URL).then(() => true, () => false);

const credentialRequest = (filename: string) => ({
  schemaSaid: TEST_SCHEMA,
  registryName: "test-reg",
  attributes: {
    content_digest: new Diger({ code: MtrDex.Blake3_256 }, new TextEncoder().encode(`${filename} ${Date.now()}`)).qb64,
    content_type: "application/pdf",
    filename,
  },
});

describe.skipIf(!keriaUp)("full chain against a real KERIA agent", () => {
  let signify: SignifyClient;
  let aidPrefix: string;
  let bridge: ExtensionBridge;
  let client: ExtensionClient;
  let wallet: typeof import("../../src");
  let issuedSaid: string;
  let schemaServer: Awaited<ReturnType<typeof serveSchema>> | undefined;

  beforeAll(async () => {
    await ready();
    signify = new SignifyClient(KERIA_URL, randomPasscode(), Tier.low, KERIA_BOOT_URL);
    await signify.boot();
    await signify.connect();

    const created = await signify.identifiers().create("wallet-aid");
    await waitOperation(signify, await created.op());
    aidPrefix = (await signify.identifiers().get("wallet-aid")).prefix;

    schemaServer = await serveSchema(TEST_SCHEMA, SCHEMA_BODY);
    const op: any = await waitOperation(
      signify,
      await signify.oobis().resolve(`${SCHEMA_OOBI_HOST}:${schemaServer.port}/oobi/${TEST_SCHEMA}`, "test-schema")
    );
    expect(op.error ?? undefined).toBeUndefined();
    expect((await signify.schemas().get(TEST_SCHEMA)).$id).toBe(TEST_SCHEMA);

    // "Extension": background router with real handlers, reached through serialized runtime messaging.
    const router = createBackgroundRouter(createReferenceHandlers(signify, "wallet-aid"));
    const listener = createRuntimeListener(router, EXTENSION_ID);
    const sender = { id: EXTENSION_ID, origin: window.location.origin, tab: { id: 42 } };
    const sendMessage = async (envelope: RuntimeEnvelope) =>
      JSON.parse(JSON.stringify(await listener(JSON.parse(JSON.stringify(envelope)), sender)));
    bridge = createContentBridge({ extensionId: EXTENSION_ID, forward: forwardViaRuntime(sendMessage) });

    client = createClient();
    wallet = await import("../../src");
  });

  afterAll(async () => {
    bridge?.dispose();
    client?.dispose();
    await schemaServer?.close();
  });

  it("handshake, then no session yet", async () => {
    expect(await wallet.isExtensionInstalled()).toBe(EXTENSION_ID);
    expect(await wallet.restoreSession()).toBeNull();
    await expect(wallet.signRequest("http://localhost/x", "GET")).rejects.toThrow("Session not found");
  });

  it("authorizeAid starts a session that restoreSession returns", async () => {
    const auth = await client.authorizeAid({ message: "Sign in" });
    expect(auth.identifier?.prefix).toBe(aidPrefix);
    expect(auth.headers?.["signify-resource"]).toBe(aidPrefix);
    expect((await wallet.restoreSession())?.identifier?.prefix).toBe(aidPrefix);
  });

  it("signRequest returns KERI headers that verify against the AID's key", async () => {
    const url = "http://localhost:9999/reports?x=1";
    const headers = await wallet.signRequest(url, "POST");
    expect(headers["signify-resource"]).toBe(aidPrefix);
    expect(headers["signature-input"]).toContain("signify");

    const state = (await signify.identifiers().get("wallet-aid")).state;
    const verifier = new Authenticater(null as any, new Verfer({ qb64: state.k[0] }));
    expect(verifier.verify(new Headers(headers), "POST", new URL(url).pathname)).toBe(true);
    // a different method must not verify (signify-ts throws instead of returning false)
    expect(() => verifier.verify(new Headers(headers), "GET", new URL(url).pathname)).toThrow(/invalid/);
  });

  it("signData signatures verify against the AID's key", async () => {
    const result = await client.signData({ items: ["hello", "world"] });
    expect(result.aid).toBe(aidPrefix);
    const verfer = new Verfer({ qb64: (await signify.identifiers().get("wallet-aid")).state.k[0] });
    for (const item of result.items) {
      const siger = new Siger({ qb64: item.signature });
      expect(verfer.verify(siger.raw, new TextEncoder().encode(item.data))).toBe(true);
    }
  });

  it("issueCredentials issues a credential and its CESR can be fetched", async () => {
    const [issued] = await wallet.issueCredentials([credentialRequest("a.pdf")]);
    expect(issued.issuer).toBe(aidPrefix);
    expect(issued.schemaSaid).toBe(TEST_SCHEMA);
    issuedSaid = issued.said;

    const cesr = await wallet.refetchCredentialCesr(issuedSaid);
    expect(cesr).toContain(TEST_SCHEMA);
    expect(cesr).toContain(issuedSaid);
  });

  it("switchIdentity re-authorizes with the credential selected by schema", async () => {
    const auth = await wallet.switchIdentity({ message: "Pick a test credential", schema: TEST_SCHEMA });
    expect(auth.identifier?.prefix).toBe(aidPrefix);
    expect((auth.credential?.raw as any).sad.s).toBe(TEST_SCHEMA);
    expect(auth.credential?.cesr).toContain(TEST_SCHEMA);
  });

  it("a failing batch rejects with IssuanceFailure listing what was already issued", async () => {
    const error = await wallet
      .issueCredentials([credentialRequest("b.pdf"), { schemaSaid: UNKNOWN_SCHEMA, registryName: "test-reg", attributes: {} }])
      .catch((e) => e);
    expect(error).toBeInstanceOf(IssuanceFailure);
    expect(error.message).toContain(UNKNOWN_SCHEMA);
    expect(error.issued).toHaveLength(1);
    expect(error.issued[0].schemaSaid).toBe(TEST_SCHEMA);
    // the partially issued credential really exists in KERIA
    expect((await signify.credentials().get(error.issued[0].said)).sad.d).toBe(error.issued[0].said);
  });
});
