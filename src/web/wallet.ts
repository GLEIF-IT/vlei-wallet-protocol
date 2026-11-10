import { createClient } from "./client.js";
import { IssuanceFailure } from "../protocol/errors.js";
import type { AuthorizeArgs, AuthorizeResult, IssuedCredential, IssueCredentialRequest } from "../protocol/types.js";

// Created on first use, so importing the library never touches `window`.
let defaultClient: ReturnType<typeof createClient> | undefined;
const client = () => (defaultClient ??= createClient());

export async function isExtensionInstalled(): Promise<string | false> {
  return client().isExtensionInstalled();
}

export async function restoreSession(): Promise<AuthorizeResult | null> {
  try {
    const result = await client().getSessionInfo();
    if (!result?.identifier && !result?.credential) return null;
    return result as AuthorizeResult;
  } catch {
    return null;
  }
}

export async function connectIdentity(args?: AuthorizeArgs): Promise<AuthorizeResult> {
  const result = await client().authorizeCred(args);
  return result as AuthorizeResult;
}

export async function switchIdentity(args?: AuthorizeArgs): Promise<AuthorizeResult> {
  try {
    await client().clearSession();
  } catch {
    // clearSession succeeds with an empty/undefined payload (there's nothing meaningful to
    // return after clearing a session) -- the vendored client's generic reply parser treats any
    // non-object payload as an error ("No payload received in response"), which is a false
    // negative here, not a real failure. Proceed to re-authorize regardless: a stale session is
    // harmless since authorizeCred() always re-prompts and establishes a fresh session anyway.
  }
  return connectIdentity(args);
}

export async function refetchCredentialCesr(said: string): Promise<string> {
  const result = await client().getCredential(said, true);
  // signify-ts's credentials().get(said, includeCESR=true) returns the raw CESR text directly
  // (res.text()), not an object -- the extension's /signify/credential/get handler passes that
  // string straight through as `credential`, so `result.credential` IS the CESR string here.
  // (When includeCESR is false, credentials().get() returns parsed JSON instead -- not this path.)
  const raw = result?.credential;
  const cesr = typeof raw === "string" ? raw : (raw as { cesr?: string } | undefined)?.cesr;
  if (!cesr || typeof cesr !== "string") {
    throw new Error("Extension did not return a CESR for this credential");
  }
  return cesr;
}

/** Signify signed headers for a request to `url` (the extension signs the exact URL's path). */
export async function signRequest(url: string, method: string): Promise<Record<string, string>> {
  const result = await client().sendMessage<
    { payload: { url: string; method: string; headers: Record<string, string> } },
    { headers: Record<string, string> }
  >("/signify/sign-request", { payload: { url, method, headers: {} } });
  return result.headers;
}

/** Issue a batch of credentials under the session's identifier after the user confirms in the extension. */
export async function issueCredentials(
  credentials: IssueCredentialRequest[]
): Promise<IssuedCredential[]> {
  try {
    const result = await client().sendMessage<
      { payload: { credentials: IssueCredentialRequest[] } },
      { credentials: IssuedCredential[] }
    >("/signify/credential/issue", { payload: { credentials } });
    return result.credentials;
  } catch (error) {
    const issued = (error as { payload?: { issued?: IssuedCredential[] } }).payload?.issued ?? [];
    throw new IssuanceFailure(error instanceof Error ? error.message : String(error), issued);
  }
}
