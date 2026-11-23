import {
  createClient,
  isExtensionInstalled,
  restoreSession,
  connectIdentity,
  switchIdentity,
  signRequest,
  issueCredentials,
  refetchCredentialCesr,
  IssuanceFailure,
} from "vlei-wallet-protocol";

// Wallet functions (connectIdentity, signRequest, issueCredentials, …) share one client the library
// creates on first use. This client is for the low-level calls the wallet functions do not cover.
const client = createClient();

const $ = (id) => document.getElementById(id);

/** Runs `action`, shows `{ ok, result }` or `{ ok: false, error, payload }` as JSON in `output`. */
async function run(output, action) {
  const el = $(output);
  el.dataset.state = "pending";
  el.textContent = "Waiting for the wallet…";
  let outcome;
  try {
    outcome = { ok: true, result: await action() };
  } catch (error) {
    outcome = { ok: false, error: error?.message ?? String(error) };
    if (error instanceof IssuanceFailure) outcome.issued = error.issued;
    else if (error?.payload !== undefined) outcome.payload = error.payload;
  }
  el.textContent = JSON.stringify(outcome, null, 2);
  el.dataset.state = "done";
  return outcome;
}

function parseJson(id, fallback) {
  const text = $(id).value.trim();
  return text ? JSON.parse(text) : fallback;
}

// --- 1. Extension ----------------------------------------------------------------------------------

function showStatus(extensionId) {
  const status = $("status");
  status.textContent = extensionId
    ? `Extension detected (id: ${extensionId})`
    : "Extension not found. Install it, then click Check again.";
  status.className = extensionId ? "status ok" : "status bad";
  status.dataset.extensionId = extensionId || "";
}

$("btn-detect").onclick = async () => {
  // A fresh client: the extension must answer its `signify-extension-client` announcement,
  // because its content script was injected long ago.
  const fresh = createClient();
  try {
    showStatus(await fresh.isExtensionInstalled());
  } finally {
    fresh.dispose();
  }
};

// --- 2. Session ------------------------------------------------------------------------------------

function addRow(list, label, value) {
  if (value === undefined || value === null || value === "") return;
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = typeof value === "string" ? value : JSON.stringify(value);
  list.append(dt, dd);
}

function renderSummary(auth) {
  const summary = $("summary");
  summary.replaceChildren();
  if (!auth) {
    addRow(summary, "Session", "none");
    return;
  }
  const { identifier, credential, headers, expiry } = auth;
  if (identifier) {
    addRow(summary, "AID name", identifier.name);
    addRow(summary, "AID prefix", identifier.prefix);
  }
  if (credential) {
    const sad = credential.raw?.sad;
    addRow(summary, "Credential", sad?.d);
    addRow(summary, "Schema", credential.raw?.schema?.title ?? sad?.s);
    addRow(summary, "Issuer", sad?.i);
  }
  if (expiry) addRow(summary, "Session expiry", new Date(expiry).toLocaleString());
  if (headers) addRow(summary, "One-time headers", Object.keys(headers).join(", "));
}

function authorizeArgs() {
  const schema = $("schema-filter").value.trim();
  return {
    message: "Select an identifier or credential for the vLEI Wallet E2E test app",
    ...(schema ? { schema } : {}),
    ...($("one-time").checked ? { session: { oneTime: true } } : {}),
  };
}

async function session(action) {
  const outcome = await run("session", action);
  if (outcome.ok) renderSummary(outcome.result);
}

$("btn-aid").onclick = () => session(() => client.authorizeAid(authorizeArgs()));
$("btn-cred").onclick = () => session(() => connectIdentity(authorizeArgs()));
$("btn-any").onclick = () => session(() => client.authorize(authorizeArgs()));
$("btn-switch").onclick = () => session(() => switchIdentity(authorizeArgs()));
$("btn-clear").onclick = () =>
  session(async () => {
    await client.clearSession();
    return restoreSession();
  });

// --- 3. Signed request -----------------------------------------------------------------------------

$("sign-url").value = `${window.location.origin}/api/reports?year=2026`;
$("btn-sign-request").onclick = () =>
  run("sign-request-result", async () => {
    const url = $("sign-url").value.trim();
    const method = $("sign-method").value;
    // Send the request with exactly these headers, e.g. fetch(url, { method, headers }).
    return { url, method, headers: await signRequest(url, method) };
  });

// --- 4. Sign data ----------------------------------------------------------------------------------

$("btn-sign-data").onclick = () =>
  run("sign-data-result", () => {
    const items = $("sign-data-items").value.split("\n").filter((line) => line !== "");
    return client.signData({ items });
  });

// --- 5. Issue --------------------------------------------------------------------------------------

$("btn-issue").onclick = () =>
  run("issue-result", () =>
    issueCredentials([
      {
        schemaSaid: $("issue-schema").value.trim(),
        registryName: $("issue-registry").value.trim(),
        attributes: parseJson("issue-attributes", {}),
      },
    ])
  );

// --- 6. Credential CESR ----------------------------------------------------------------------------

$("btn-cesr").onclick = () => run("cesr-result", () => refetchCredentialCesr($("cesr-said").value.trim()));

// --- 7. Raw message --------------------------------------------------------------------------------

$("btn-raw").onclick = () =>
  run("raw-result", () => {
    const payload = parseJson("raw-payload", undefined);
    return client.sendMessage($("raw-type").value.trim(), payload === undefined ? {} : { payload });
  });

// --- Start -----------------------------------------------------------------------------------------

showStatus(await isExtensionInstalled());
await session(() => restoreSession());
