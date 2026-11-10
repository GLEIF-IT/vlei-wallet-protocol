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
} from "../protocol/types.js";

type PendingRequest<T = unknown> = { resolve: (value: T) => void; reject: (reason: Error) => void };

class Deferred<T = void> implements PromiseLike<T> {
  promise: Promise<T>;
  resolve: (value: T) => void = () => {};
  reject: (reason?: Error) => void = () => {};

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null | undefined,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined
  ): PromiseLike<TResult1 | TResult2> {
    return this.promise.then(onfulfilled, onrejected);
  }
}

export interface ExtensionClientOptions {
  targetOrigin?: string;
}

export class ExtensionClient {
  #requests = new Map<string, PendingRequest>();
  #extensionIdPromise: Deferred<string | false> = new Deferred<string | false>();

  constructor(private options: ExtensionClientOptions) {
    this.sendMessage = this.sendMessage.bind(this);
    window.addEventListener("message", this.#handleEvent, false);
    window.postMessage({ type: "signify-extension-client" }, this.options.targetOrigin ?? "/");
  }

  #handleEvent = async (event: MessageEvent) => {
    if (event.source !== window) return;
    if (!event.data || typeof event.data !== "object") return;

    const { requestId, type, error, payload } = event.data;
    if (!type || typeof type !== "string") return;

    if (type === "signify-extension") {
      if (typeof event.data.data?.extensionId !== "string") return;
      this.#extensionIdPromise.resolve(event.data.data.extensionId);
      return;
    }

    if (type === "/signify/reply" && requestId && typeof requestId === "string") {
      const promise = this.#requests.get(requestId);
      if (!promise) return;

      if (error) {
        // Keep the reply's payload: e.g. a failed batch issuance reports which credentials it
        // had already issued before it failed.
        const failure = new Error(typeof error === "string" ? error : String(error)) as Error & {
          payload?: unknown;
        };
        failure.payload = payload;
        promise.reject(failure);
      } else if (!payload || typeof payload !== "object") {
        promise.reject(new Error("No payload received in response"));
      } else {
        promise.resolve(payload);
      }
      this.#requests.delete(requestId);
    }
  };

  isExtensionInstalled = async (timeout = 3000): Promise<string | false> => {
    const timer = setTimeout(() => {
      this.#extensionIdPromise.resolve(false);
    }, timeout);
    const result = await this.#extensionIdPromise;
    clearTimeout(timer);
    return result;
  };

  authorize = async (payload?: AuthorizeArgs): Promise<AuthorizeResult> => {
    const { schema, ...rest } = payload ?? {};
    return this.sendMessage("/signify/authorize", { payload: rest, schema });
  };

  authorizeAid = async (payload?: AuthorizeArgs): Promise<AuthorizeResult> => {
    return this.sendMessage("/signify/authorize/aid", { payload });
  };

  authorizeCred = async (payload?: AuthorizeArgs): Promise<AuthorizeResult> => {
    const { schema, ...rest } = payload ?? {};
    return this.sendMessage("/signify/authorize/credential", { payload: rest, schema });
  };

  signData = async (payload: SignDataArgs): Promise<SignDataResult> => {
    return this.sendMessage("/signify/sign-data", { payload });
  };

  getSessionInfo = async (payload?: AuthorizeArgs): Promise<AuthorizeResult> => {
    return this.sendMessage("/signify/get-session-info", { payload });
  };

  clearSession = async (payload?: AuthorizeArgs): Promise<AuthorizeResult> => {
    return this.sendMessage("/signify/clear-session", { payload });
  };

  getCredential = async (said: string, includeCESR = false): Promise<CredentialResult> => {
    return this.sendMessage("/signify/credential/get", { payload: { id: said, includeCESR } });
  };

  // polaris-web methods
  signRequest = async (payload: SignRequestArgs): Promise<SignRequestResult> => {
    return this.sendMessage("/signify/sign-request", { payload });
  };

  createDataAttestationCredential = async (payload: CreateDataAttestationCredentialArgs): Promise<CreateDataAttestationCredentialResult> => {
    return this.sendMessage("/signify/credential/create/data-attestation", { payload });
  };

  configureVendor = async (payload?: ConfigureVendorArgs): Promise<void> => {
    return this.sendMessage("/signify/configure-vendor", { payload });
  };

  // additions
  issueCredentials = async (payload: { credentials: IssueCredentialRequest[] }): Promise<{ credentials: IssuedCredential[] }> => {
    return this.sendMessage("/signify/credential/issue", { payload });
  };

  /** TODO: stub, reserved for later use. */
  authorizeAutoSignin = async (payload?: AuthorizeArgs): Promise<AuthorizeResult> => {
    return this.sendMessage("/signify/authorize-auto-signin", { payload });
  };

  /** Stops listening and rejects pending requests. */
  dispose(): void {
    window.removeEventListener("message", this.#handleEvent, false);
    for (const pending of this.#requests.values()) pending.reject(new Error("Client disposed"));
    this.#requests.clear();
  }

  sendMessage = async <TRequest, TResponse>(type: string, payload?: TRequest): Promise<TResponse> => {
    const requestId = window.crypto.randomUUID();
    const promise = new Promise<TResponse>((resolve, reject) => {
      this.#requests.set(requestId, {
        resolve(value: unknown) {
          resolve(value as TResponse);
        },
        reject,
      });
    });
    window.postMessage({ requestId, type, ...(payload ?? {}) }, this.options.targetOrigin ?? "/");
    return promise;
  };
}

export function createClient(options?: ExtensionClientOptions): ExtensionClient {
  return new ExtensionClient(options ?? {});
}
