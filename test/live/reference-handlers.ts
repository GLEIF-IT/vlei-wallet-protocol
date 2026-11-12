import { Saider, type CredentialData, type Operation, type SignifyClient } from "signify-ts";
import {
  HandlerError,
  PROTOCOL_ERRORS,
  type AuthorizeResult,
  type IssueCredentialRequest,
  type IssuedCredential,
  type ProtocolHandlers,
  type RequestContext,
} from "../../src/extension";

/**
 * Reference background handlers backed by a real SignifyClient. "User prompts" are auto-approved:
 * authorize* picks the given AID (and, for credentials, the first matching credential).
 * Issuance is a trimmed port of the extension's `issueBatch` (credential-issuance.ts).
 */
export function createReferenceHandlers(client: SignifyClient, aidName: string): Partial<ProtocolHandlers> {
  type Session = { aidName: string; result: AuthorizeResult };
  const sessions = new Map<string, Session>();
  const key = (c: RequestContext) => `${c.tabId}|${c.origin}`;
  const requireSession = (c: RequestContext) => {
    const session = sessions.get(key(c));
    if (!session) throw new HandlerError(PROTOCOL_ERRORS.sessionNotFound);
    return session;
  };

  const authorize = async (
    context: RequestContext,
    oneTime: boolean | undefined,
    withCredential: boolean,
    schema?: string
  ): Promise<AuthorizeResult> => {
    const aid = await client.identifiers().get(aidName);
    const result: AuthorizeResult = { identifier: { prefix: aid.prefix } };
    if (withCredential) {
      const creds: any[] = await client.credentials().list(schema ? { filter: { "-s": schema } } : {});
      const raw = creds.find((c) => c.sad.i === aid.prefix);
      if (!raw) throw new HandlerError(PROTOCOL_ERRORS.cancelled);
      result.credential = { raw, cesr: await client.credentials().get(raw.sad.d, true) };
    }
    const signed = await client.createSignedRequest(aidName, context.origin, {});
    result.headers = Object.fromEntries(signed.headers.entries());
    if (!oneTime) sessions.set(key(context), { aidName, result });
    return result;
  };

  return {
    "/signify/authorize/aid": ({ payload }, c) => authorize(c, payload?.session?.oneTime, false),
    "/signify/authorize/credential": ({ payload, schema }, c) => authorize(c, payload?.session?.oneTime, true, schema),

    "/signify/get-session-info": (_r, c) => requireSession(c).result,

    "/signify/clear-session": (_r, c) => {
      sessions.delete(key(c));
    },

    "/signify/sign-request": async ({ payload }, c) => {
      if (!payload?.url) throw new HandlerError(PROTOCOL_ERRORS.missingData);
      const session = requireSession(c);
      const signed = await client.createSignedRequest(session.aidName, payload.url, {
        method: payload.method ?? "GET",
        headers: new Headers(payload.headers ?? {}),
      });
      return { headers: Object.fromEntries(signed.headers.entries()) };
    },

    "/signify/sign-data": async ({ payload }, c) => {
      if (!payload?.items) throw new HandlerError(PROTOCOL_ERRORS.missingData);
      const hab = await client.identifiers().get(requireSession(c).aidName);
      const signer = client.manager!.get(hab).signers[0];
      return {
        aid: hab.prefix,
        items: payload.items.map((data) => ({
          data,
          signature: signer.sign(new TextEncoder().encode(data), 0).qb64,
        })),
      };
    },

    "/signify/credential/get": async ({ payload }) => {
      if (!payload?.id) throw new HandlerError(PROTOCOL_ERRORS.missingData);
      return { credential: await client.credentials().get(payload.id, payload.includeCESR ?? false) };
    },

    "/signify/credential/issue": async ({ payload }, c) => {
      const session = requireSession(c);
      return { credentials: await issueBatch(client, session.aidName, payload?.credentials ?? []) };
    },
  };
}

export async function waitOperation<T>(client: SignifyClient, op: Operation<T>, retries = 120, delay = 250) {
  while (retries-- > 0) {
    op = await client.operations().get(op.name);
    if (op.done) return op;
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error(`Operation ${op.name} timed out`);
}

async function issueBatch(
  client: SignifyClient,
  aidName: string,
  requests: IssueCredentialRequest[]
): Promise<IssuedCredential[]> {
  const issued: IssuedCredential[] = [];
  try {
    if (requests.length === 0) throw new Error("Provide at least one credential to issue");
    const aid = await client.identifiers().get(aidName);
    for (const request of requests) {
      let registry = ((await client.registries().list(aidName)) ?? []).find((r: any) => r.name === request.registryName);
      if (!registry) {
        const created = await client.registries().create({ name: aidName, registryName: request.registryName, noBackers: true });
        await waitOperation(client, await created.op());
        registry = (await client.registries().list(aidName)).find((r: any) => r.name === request.registryName);
      }
      const schema = await client.schemas().get(request.schemaSaid).catch(() => null);
      if (!schema || schema.title === "404 Not Found") {
        throw new Error(`Schema ${request.schemaSaid} not found — it must be resolved by KERIA first`);
      }
      const args: CredentialData = {
        i: aid.prefix,
        ri: registry.regk,
        s: request.schemaSaid,
        a: request.attributes as CredentialData["a"],
        e: request.edges ? Saider.saidify({ d: "", ...request.edges })[1] : undefined,
        r: request.rules ? Saider.saidify({ d: "", ...request.rules })[1] : undefined,
      };
      const result = await client.credentials().issue(aidName, args);
      const done: any = await waitOperation(client, result.op);
      if (done.error) throw new Error(done.error.message ?? `Issuing ${request.schemaSaid} failed`);
      const sad: any = result.acdc.ked;
      issued.push({
        said: sad.d,
        schemaSaid: request.schemaSaid,
        registryName: request.registryName,
        issuer: aid.prefix,
        issuedAt: sad.a?.dt ?? null,
      });
    }
  } catch (error) {
    throw new HandlerError(error instanceof Error ? error.message : String(error), { issued });
  }
  return issued;
}
