import {
  isExtensionInstalled,
  restoreSession,
  connectIdentity,
  signRequest,
  issueCredentials,
  IssuanceFailure,
} from "vlei-wallet-protocol";

// SAID of the credential schema to issue; the wallet's KERIA agent must already resolve it (schema OOBI)
const SCHEMA_SAID = "EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao";

if (!(await isExtensionInstalled())) throw new Error("vLEI Wallet extension not found");

// Sign in: reuse the tab's session, or ask the user to pick a credential
const auth = (await restoreSession()) ?? (await connectIdentity({ message: "Select your credential" }));
console.log("Signed in as", auth.identifier ?? auth.credential);

// Signed request to your API
const url = "https://api.example.com/reports";
const res = await fetch(url, { headers: await signRequest(url, "GET") });
console.log("API status", res.status);

// Issue credentials (the user approves in the extension)
try {
  const issued = await issueCredentials([
    { schemaSaid: SCHEMA_SAID, registryName: "my-registry", attributes: { LEI: "5493001KJTIIGC8Y1R17" } },
  ]);
  console.log("Issued", issued.map((c) => c.said));
} catch (e) {
  // Credentials anchored before the failure stay issued: record them before retrying
  if (e instanceof IssuanceFailure) console.warn("Issued before failure", e.issued.map((c) => c.said));
  throw e;
}