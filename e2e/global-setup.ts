import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_PATH, KERIA_BOOT_URL, KERIA_URL } from "./env";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Fails fast, with what to do, when an input of the E2E run is missing. */
export default async function globalSetup() {
  const problems: string[] = [];

  if (!EXTENSION_PATH) {
    problems.push("VLEI_EXTENSION_PATH is not set: point it at an unpacked, built wallet extension (its manifest.json folder).");
  } else if (!existsSync(join(resolve(EXTENSION_PATH), "manifest.json"))) {
    problems.push(`VLEI_EXTENSION_PATH=${EXTENSION_PATH} has no manifest.json. Build the extension first.`);
  }
  if (!existsSync(join(root, "dist", "index.js"))) {
    problems.push("The library is not built: run `npm run build` (npm run test:e2e does it).");
  }
  if (!existsSync(join(root, "e2e", "e2e-testable-web-app", "node_modules", "vlei-wallet-protocol"))) {
    problems.push("The e2e-testable web app has no dependencies: run `npm --prefix e2e/e2e-testable-web-app install`.");
  }
  for (const url of [KERIA_URL, KERIA_BOOT_URL]) {
    const reachable = await fetch(url).then(
      () => true,
      () => false
    );
    if (!reachable) problems.push(`KERIA is not reachable at ${url} (set KERIA_URL / KERIA_BOOT_URL).`);
  }

  if (problems.length) throw new Error(`E2E prerequisites missing:\n- ${problems.join("\n- ")}`);
}
