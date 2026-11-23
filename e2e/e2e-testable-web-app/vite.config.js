import { defineConfig } from "vite";

// The extension's content script matches http://localhost/*, so serve on localhost.
// es2022: src/main.js uses top-level await.
export default defineConfig({
  server: { host: "localhost", port: 3000, strictPort: true },
  preview: { host: "localhost" },
  build: { target: "es2022" },
});
