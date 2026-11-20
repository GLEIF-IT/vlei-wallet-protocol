import type { BrowserContext, Page, Worker } from "@playwright/test";
import type { Harness } from "../harness";

export interface DriverContext {
  context: BrowserContext;
  extensionId: string;
  /** The extension's background service worker. */
  serviceWorker: Worker;
  harness: Harness;
}

/**
 * Everything the E2E tests need from a particular wallet extension's own UI. The protocol tests use only
 * this interface, so another extension (e.g. docs/examples/demo-extension) plugs in with its own driver.
 */
export interface WalletDriver {
  readonly name: string;
  /** Connects the wallet to the harness's KERIA agent (agent URL, boot URL, passcode). */
  connect(): Promise<void>;
  /**
   * Makes the harness's AID and both held credentials selectable for sign-in on `origin`,
   * in this order: AID, holder credential, issue-schema credential.
   */
  addSignins(origin: string): Promise<void>;
  /** Waits for the sign-in prompt on `page` and returns how many choices it lists. */
  promptedChoices(page: Page): Promise<number>;
  /** Picks choice `index` (in listed order) in the sign-in prompt on `page` and confirms. */
  pickSignin(page: Page, index: number): Promise<void>;
  /** Closes the sign-in prompt on `page` without choosing. */
  cancelSignin(page: Page): Promise<void>;
  /**
   * Starts waiting for the extension's issuance approval and answers it. Call before triggering
   * issuance; the returned promise settles once the decision is made.
   */
  answerIssuance(decision: "approve" | "deny"): Promise<void>;
  /** Number of issuance approval windows open right now. */
  openIssuancePrompts(): number;
}
