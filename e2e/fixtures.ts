import { chromium, expect, test as base, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createVleiWalletDriver } from "./drivers/vlei-wallet";
import type { DriverContext, WalletDriver } from "./drivers/types";
import { APP_URL, EXTENSION_DRIVER, EXTENSION_PATH, HEADED } from "./env";
import { createHarness, type Harness } from "./harness";

const DRIVERS: Record<string, (context: DriverContext) => WalletDriver> = {
  "vlei-wallet": createVleiWalletDriver,
};

interface WorkerFixtures {
  harness: Harness;
  /** Chromium with the wallet extension loaded (persistent context). */
  extensionContext: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  driver: WalletDriver;
  /** The e2e-testable web app, opened once with a connected wallet and sign-ins for its origin. */
  app: Page;
}

/**
 * Worker-scoped: one browser, one wallet and one app page for the whole (serial) suite, because each
 * step builds on the session the previous one created.
 */
export const test = base.extend<{}, WorkerFixtures>({
  harness: [
    async ({}, use) => {
      const harness = await createHarness();
      await use(harness);
      await harness.close();
    },
    { scope: "worker", timeout: 180_000 },
  ],

  extensionContext: [
    async ({}, use) => {
      const extension = resolve(EXTENSION_PATH);
      const userDataDir = mkdtempSync(join(tmpdir(), "vlei-e2e-"));
      // channel "chromium": Playwright's Chromium in new headless mode, which loads extensions
      // (branded Chrome 137+ ignores --load-extension).
      const context = await chromium.launchPersistentContext(userDataDir, {
        channel: "chromium",
        headless: !HEADED,
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      });
      await use(context);
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],

  serviceWorker: [
    async ({ extensionContext: context }, use) => {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
      await use(worker);
    },
    { scope: "worker" },
  ],

  extensionId: [async ({ serviceWorker }, use) => use(new URL(serviceWorker.url()).host), { scope: "worker" }],

  driver: [
    async ({ extensionContext: context, extensionId, serviceWorker, harness }, use) => {
      const create = DRIVERS[EXTENSION_DRIVER];
      if (!create) throw new Error(`Unknown VLEI_EXTENSION_DRIVER "${EXTENSION_DRIVER}" (known: ${Object.keys(DRIVERS)})`);
      await use(create({ context, extensionId, serviceWorker, harness }));
    },
    { scope: "worker" },
  ],

  app: [
    async ({ extensionContext: context, driver }, use) => {
      await driver.connect();
      await driver.addSignins(new URL(APP_URL).origin);
      const page = context.pages().find((p) => p.url() === "about:blank") ?? (await context.newPage());
      await page.goto(APP_URL);
      await page.bringToFront(); // the extension only answers the active tab
      await use(page);
    },
    { scope: "worker", timeout: 180_000 },
  ],
});

export { expect };

/** Clicks `button` in the app and returns the JSON outcome the app prints in `output`. */
export async function act(page: Page, button: string, output: string): Promise<any> {
  await page.getByTestId(button).click();
  return outcome(page, output);
}

/** The `{ ok, result | error, payload?, issued? }` JSON the app printed in `output`, once settled. */
export async function outcome(page: Page, output: string): Promise<any> {
  const el = page.locator(`[data-testid="${output}"][data-state="done"]`);
  await expect(el).toBeVisible({ timeout: 120_000 });
  return JSON.parse((await el.textContent()) ?? "null");
}
