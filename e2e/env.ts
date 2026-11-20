/** E2E settings, all from the environment. */
export const EXTENSION_PATH = process.env.VLEI_EXTENSION_PATH ?? "";
export const EXTENSION_DRIVER = process.env.VLEI_EXTENSION_DRIVER ?? "vlei-wallet";
export const KERIA_URL = process.env.KERIA_URL ?? "http://localhost:3901";
export const KERIA_BOOT_URL = process.env.KERIA_BOOT_URL ?? "http://localhost:3903";
/** How KERIA (in Docker) reaches this machine to resolve the test schemas. */
export const SCHEMA_OOBI_HOST = process.env.SCHEMA_OOBI_HOST ?? "http://host.docker.internal";
/** The e2e-testable web app (e2e/e2e-testable-web-app), served by Playwright's webServer. */
export const APP_URL = "http://localhost:3000";
export const HEADED = process.env.HEADED === "1";
