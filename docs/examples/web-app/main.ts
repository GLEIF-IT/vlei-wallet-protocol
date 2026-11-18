import { isExtensionInstalled, restoreSession, connectIdentity, signRequest } from "vlei-wallet-protocol";

const status = document.getElementById("status")!;
const out = document.getElementById("out")!;
const show = (value: unknown) => (out.textContent = JSON.stringify(value, null, 2));
const showError = (error: unknown) => (out.textContent = `Error: ${(error as Error).message}`);

// 1. Is there a vLEI wallet in the browser? And has the user already signed in on this tab?
isExtensionInstalled().then(async (extensionId) => {
  if (!extensionId) return (status.textContent = "Extension not found");
  status.textContent = `Found extension ${extensionId}`;
  const session = await restoreSession();
  if (session) {
    status.textContent = "Already signed in";
    show(session);
  }
});

// 2. Sign-in: the wallet asks the user which vLEI to present.
document.getElementById("login")!.onclick = () =>
  connectIdentity({ message: "Sign in to the demo app" })
    .then((auth) => {
      status.textContent = "Signed in";
      show(auth);
    })
    .catch(showError);

// 3. Signed request: the wallet signs it with the user's key, your server verifies the signature.
document.getElementById("sign")!.onclick = () => signRequest(location.href, "GET").then(show).catch(showError);
