// Shared payload and result types (PROTOCOL_DEMO.md §8 "Shared").

export interface SessionArgs {
  oneTime?: boolean;
}

export interface AuthorizeArgs {
  message?: string;
  session?: SessionArgs;
  /** Schema SAID filter; sent as a top-level message field. */
  schema?: string;
}

export interface AuthorizeResultCredential {
  raw: unknown;
  cesr: string;
}

export interface AuthorizeResultIdentifier {
  prefix: string;
  /** Wallet-local name of the identifier, if the extension shares it. */
  name?: string;
}

export interface AuthorizeResult {
  credential?: AuthorizeResultCredential;
  identifier?: AuthorizeResultIdentifier;
  /** One-time mode (`session.oneTime`): headers signed for the page origin. */
  headers?: Record<string, string>;
  /** Session mode: when the session ends, epoch ms. */
  expiry?: number;
}

export interface SignRequestArgs {
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

export interface SignRequestResult {
  headers: Record<string, string>;
}

export interface SignDataArgs {
  message?: string;
  items: string[];
}

export interface SignDataResultItem {
  data: string;
  signature: string;
}

export interface SignDataResult {
  aid: string;
  items: SignDataResultItem[];
}

export interface CredentialResult {
  credential: any;
}

export interface CreateDataAttestationCredentialArgs {
  credData: any;
  schemaSaid: string;
}

export interface CreateDataAttestationCredentialResult {
  acdc: Record<string, any>;
  iss: Record<string, any>;
  anc: Record<string, any>;
  op: Record<string, any>;
}

export interface ConfigureVendorArgs {
  url: string;
}

export interface IssueCredentialRequest {
  schemaSaid: string;
  registryName: string;
  attributes: Record<string, unknown>;
  edges?: Record<string, unknown>;
  rules?: Record<string, unknown>;
}

export interface IssuedCredential {
  said: string;
  schemaSaid: string;
  registryName: string;
  issuer: string;
  issuedAt: string | null;
}
