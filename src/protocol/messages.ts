import { HANDSHAKE, MESSAGE_PREFIX, REPLY_TYPE } from "./constants.js";
import type {
  AuthorizeArgs,
  AuthorizeResult,
  ConfigureVendorArgs,
  CreateDataAttestationCredentialArgs,
  CreateDataAttestationCredentialResult,
  CredentialResult,
  IssueCredentialRequest,
  IssuedCredential,
  SignDataArgs,
  SignDataResult,
  SignRequestArgs,
  SignRequestResult,
} from "./types.js";

type AuthorizePayload = Omit<AuthorizeArgs, "schema">;

/**
 * Message type → `payload`, extra top-level fields, reply `result`.
 *
 * It is an interface so apps and extensions can add their own message types with module augmentation:
 *
 * ```ts
 * declare module "vlei-wallet-protocol/protocol" {
 *   interface ProtocolMap {
 *     "/acme/ping": { payload: { n: number }; extra: {}; result: { pong: number } };
 *   }
 * }
 * ```
 */
export interface ProtocolMap {
  "/signify/authorize": { payload: AuthorizePayload; extra: { schema?: string }; result: AuthorizeResult };
  "/signify/authorize/aid": { payload: AuthorizePayload; extra: {}; result: AuthorizeResult };
  "/signify/authorize/credential": { payload: AuthorizePayload; extra: { schema?: string }; result: AuthorizeResult };
  /** TODO: stub, reserved for later use. */
  "/signify/authorize-auto-signin": { payload: AuthorizePayload; extra: {}; result: AuthorizeResult };
  "/signify/get-session-info": { payload: undefined; extra: {}; result: AuthorizeResult };
  "/signify/clear-session": { payload: undefined; extra: {}; result: {} };
  "/signify/sign-request": { payload: SignRequestArgs; extra: {}; result: SignRequestResult };
  "/signify/sign-data": { payload: SignDataArgs; extra: {}; result: SignDataResult };
  "/signify/credential/get": { payload: { id: string; includeCESR?: boolean }; extra: {}; result: CredentialResult };
  "/signify/credential/issue": {
    payload: { credentials: IssueCredentialRequest[] };
    extra: {};
    result: { credentials: IssuedCredential[] };
  };
  "/signify/credential/create/data-attestation": {
    payload: CreateDataAttestationCredentialArgs;
    extra: {};
    result: CreateDataAttestationCredentialResult;
  };
  "/signify/configure-vendor": { payload: ConfigureVendorArgs; extra: {}; result: {} };
}

export type MessageType = keyof ProtocolMap & string;
export type PayloadOf<T extends MessageType> = ProtocolMap[T]["payload"];
export type ExtraOf<T extends MessageType> = ProtocolMap[T]["extra"];
export type ResultOf<T extends MessageType> = ProtocolMap[T]["result"];

/** Page → extension request as posted on `window`: `{ type, requestId, payload?, ...extra }`. */
export type RequestEnvelope<T extends MessageType = MessageType> = {
  type: T;
  requestId: string;
  payload?: PayloadOf<T>;
} & ExtraOf<T>;

/** Extension → page reply. Success: `payload` is an object. Error: `error` is set, `payload` optional. */
export type ReplyEnvelope =
  | { type: typeof REPLY_TYPE; requestId: string; payload: object; error?: undefined }
  | { type: typeof REPLY_TYPE; requestId: string; error: string; payload?: object };

export interface HandshakeClientMessage {
  type: typeof HANDSHAKE.client;
}

export interface HandshakeExtensionMessage {
  type: typeof HANDSHAKE.extension;
  data: { extensionId: string };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** A page request: string `/signify/*` type (not the reply type) and a string `requestId`. */
export function isProtocolRequest(data: unknown): data is RequestEnvelope {
  return (
    isObject(data) &&
    typeof data.type === "string" &&
    data.type.startsWith(MESSAGE_PREFIX) &&
    data.type !== REPLY_TYPE &&
    typeof data.requestId === "string" &&
    data.requestId !== ""
  );
}

export function isReply(data: unknown): data is ReplyEnvelope {
  return isObject(data) && data.type === REPLY_TYPE && typeof data.requestId === "string";
}

export function isHandshakeClient(data: unknown): data is HandshakeClientMessage {
  return isObject(data) && data.type === HANDSHAKE.client;
}

export function isHandshakeExtension(data: unknown): data is HandshakeExtensionMessage {
  return (
    isObject(data) &&
    data.type === HANDSHAKE.extension &&
    isObject(data.data) &&
    typeof data.data.extensionId === "string"
  );
}
