import { expect, type Page } from "@playwright/test";
import { KERIA_BOOT_URL, KERIA_URL } from "../env";
import type { DriverContext, WalletDriver } from "./types";

// Only used inside serviceWorker.evaluate(), which runs in the extension.
declare const chrome: any;

/**
 * Driver for the vLEI Wallet extension (GLEIF-IT/signify-browser-extension, `dist/chrome`).
 *
 * - Connects through its popup page, opened in a tab (config screen → passcode screen).
 * - Sign-ins are stored in `chrome.storage.local.signins[<controller AID>]`. The extension creates them from
 *   its toolbar popup bound to the page's tab, which Playwright cannot open, so they are written directly
 *   through the service worker in the shape the popup writes.
 * - Sign-in prompts are rendered by its content script in the page (`select-signin-N`, `select-signin-button`,
 *   `dialog-close`); issuance is approved in an extension window (`issue-confirm/index.html`).
 */
export function createVleiWalletDriver({ context, extensionId, serviceWorker, harness }: DriverContext): WalletDriver {
  const popupUrl = `chrome-extension://${extensionId}/src/pages/popup/index.html`;
  const isConfirmPage = (page: Page) => page.url().includes("/src/pages/issue-confirm/index.html");

  return {
    name: "vlei-wallet",

    async connect() {
      const popup = await context.newPage();
      await popup.goto(popupUrl);
      await popup.getByTestId("settings-agent-url").fill(KERIA_URL);
      await popup.getByTestId("settings-boot-url").fill(KERIA_BOOT_URL);
      await popup.getByTestId("settings-save").click();
      await popup.getByTestId("signin-passcode").fill(harness.passcode);
      await popup.getByTestId("signin-connect").click();
      await expect
        .poll(() => serviceWorker.evaluate(async () => (await chrome.storage.session.get("controller-id"))["controller-id"]), {
          message: "the extension did not connect to the KERIA agent",
          timeout: 60_000,
        })
        .toBe(harness.controller);
      await popup.close();
    },

    async addSignins(origin) {
      const now = Date.now();
      const signin = (id: string, value: object) => ({ id, domain: origin, createdAt: now, updatedAt: now, ...value });
      const credential = (raw: any) => ({ ...raw, issueeName: harness.aidName });
      const signins = [
        signin("e2e-aid", { identifier: harness.identifier }),
        signin("e2e-holder-credential", { credential: credential(harness.heldCredentials.holder) }),
        signin("e2e-issue-credential", { credential: credential(harness.heldCredentials.issue) }),
      ];
      await serviceWorker.evaluate(
        async ({ controller, signins }) => {
          const { signins: all = {} } = await chrome.storage.local.get("signins");
          await chrome.storage.local.set({ signins: { ...all, [controller]: signins } });
        },
        { controller: harness.controller, signins }
      );
    },

    async promptedChoices(page) {
      await expect(page.getByTestId("dialog-close")).toBeVisible();
      await expect(page.getByTestId("dialog-title")).toBeVisible();
      // The dialog renders its sign-in list together with its title.
      return page.locator('[data-testid^="select-signin-"]:not([data-testid="select-signin-button"])').count();
    },

    async pickSignin(page, index) {
      await page.getByTestId(`select-signin-${index}`).click();
      await page.getByTestId("select-signin-button").click();
      await expect(page.getByTestId("dialog-close")).toBeHidden();
    },

    async cancelSignin(page) {
      await page.getByTestId("dialog-close").click();
      await expect(page.getByTestId("dialog-close")).toBeHidden();
    },

    async answerIssuance(decision) {
      const confirm = await context.waitForEvent("page", { predicate: isConfirmPage, timeout: 60_000 });
      const button = confirm.getByRole("button", { name: decision === "approve" ? "Approve" : "Deny" });
      // The window closes itself right after the click: listen first, and tolerate a click that races the close.
      const closed = confirm.isClosed() ? Promise.resolve() : confirm.waitForEvent("close").then(() => undefined);
      await button.click().catch((error) => {
        if (!confirm.isClosed()) throw error;
      });
      await closed;
    },

    openIssuancePrompts() {
      return context.pages().filter(isConfirmPage).length;
    },
  };
}
