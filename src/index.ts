/** Web-app entry: client, wallet functions and the shared protocol. */
export * from "./protocol.js";
export { ExtensionClient, createClient, type ExtensionClientOptions } from "./web/client.js";
export {
  isExtensionInstalled,
  restoreSession,
  connectIdentity,
  switchIdentity,
  refetchCredentialCesr,
  signRequest,
  issueCredentials,
} from "./web/wallet.js";
