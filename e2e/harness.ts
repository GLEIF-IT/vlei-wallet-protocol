import { Diger, MtrDex, SignifyClient, Tier, randomPasscode, ready } from "signify-ts";
import { waitOperation } from "../test/live/reference-handlers";
import { makeTestSchema, serveSchemas, type SchemaServer } from "../test/live/schema-server";
import { KERIA_BOOT_URL, KERIA_URL, SCHEMA_OOBI_HOST } from "./env";

/**
 * The wallet's KERIA side, prepared from Node with signify-ts: a fresh agent (random passcode) the extension
 * then connects to, one AID, two resolvable schemas, and two credentials held by that AID.
 */
export interface Harness {
  client: SignifyClient;
  passcode: string;
  /** Controller AID of the agent; the extension stores sign-ins under it. */
  controller: string;
  aidName: string;
  aidPrefix: string;
  /** The AID as `identifiers().list()` returns it (what the extension stores in a sign-in). */
  identifier: Record<string, unknown>;
  /** Schema for credentials the page issues (attributes: filename, content_digest). */
  issueSchema: string;
  /** Schema for credentials held by the AID (`a.i` required), used for credential sign-in. */
  holderSchema: string;
  /** Credentials held by the AID, as `credentials().list()` returns them: one per schema. */
  heldCredentials: { holder: any; issue: any };
  /** Attributes for a credential of `issueSchema`. */
  issueAttributes(filename: string): Record<string, string>;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  await ready();
  const passcode = randomPasscode();
  const client = new SignifyClient(KERIA_URL, passcode, Tier.low, KERIA_BOOT_URL);
  await client.boot();
  await client.connect();

  const aidName = "e2e-aid";
  await waitOperation(client, await (await client.identifiers().create(aidName)).op());
  const aidPrefix: string = (await client.identifiers().get(aidName)).prefix;
  const identifier = (await client.identifiers().list()).aids.find((aid: any) => aid.name === aidName);

  const issue = makeTestSchema();
  const holder = makeTestSchema({
    title: "Protocol Holder Credential",
    credentialType: "ProtocolHolderCredential",
    holder: true,
  });
  const schemaServer: SchemaServer = await serveSchemas({ [issue.said]: issue.body, [holder.said]: holder.body });
  for (const said of [issue.said, holder.said]) {
    const op: any = await waitOperation(
      client,
      await client.oobis().resolve(`${SCHEMA_OOBI_HOST}:${schemaServer.port}/oobi/${said}`, said)
    );
    if (op.error) throw new Error(`KERIA could not resolve schema ${said}: ${JSON.stringify(op.error)}`);
  }

  const registryName = "e2e-held";
  await waitOperation(client, await (await client.registries().create({ name: aidName, registryName, noBackers: true })).op());
  const registry = (await client.registries().list(aidName)).find((r: any) => r.name === registryName);

  const issueAttributes = (filename: string) => ({
    filename,
    content_digest: new Diger({ code: MtrDex.Blake3_256 }, new TextEncoder().encode(`${filename} ${Date.now()}`)).qb64,
  });

  // Self-issued, held by the AID: the extension resolves the holder's AID name from `a.i`.
  const issueHeld = async (schema: string, filename: string) => {
    const result = await client.credentials().issue(aidName, {
      i: aidPrefix,
      ri: registry.regk,
      s: schema,
      a: { i: aidPrefix, ...issueAttributes(filename) },
    });
    const done: any = await waitOperation(client, result.op);
    if (done.error) throw new Error(`Issuing a held ${schema} credential failed: ${JSON.stringify(done.error)}`);
    const said: string = (result.acdc as any).ked.d;
    const listed: any[] = await client.credentials().list();
    return listed.find((credential) => credential.sad.d === said);
  };
  const heldCredentials = {
    holder: await issueHeld(holder.said, "holder.pdf"),
    issue: await issueHeld(issue.said, "held.pdf"),
  };

  const state = await client.state();
  return {
    client,
    passcode,
    controller: state.controller.state.i,
    aidName,
    aidPrefix,
    identifier,
    issueSchema: issue.said,
    holderSchema: holder.said,
    heldCredentials,
    issueAttributes,
    close: () => schemaServer.close(),
  };
}
