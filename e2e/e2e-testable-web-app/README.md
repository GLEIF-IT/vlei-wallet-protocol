# e2e-testable web app

The page the end-to-end tests (`npm run test:e2e` at the root) drive. It is **not** an example: the examples live in
[`docs/examples`](../../docs/examples). Its `data-testid` attributes are what the tests use, so keep them stable.

Plain HTML + JavaScript, served by Vite on http://localhost:3000, exercising every library call. Every action prints
`{ ok: true, result }` or `{ ok: false, error, payload }` as JSON.

```bash
# from the repository root, once before npm run test:e2e
npm install && npm run build                     # the page uses the built library (dist/)
npm --prefix e2e/e2e-testable-web-app install
```

| Section | Library call |
|---|---|
| Extension | `isExtensionInstalled()`; "Check again" uses a fresh `createClient()` (handshake on request) |
| Session | `client.authorizeAid` / `connectIdentity` (credential) / `client.authorize`, `switchIdentity`, `client.clearSession`, `restoreSession` on load; options: schema filter, one-time |
| Signed request | `signRequest(url, method)`: send the request with exactly these headers |
| Sign data | `client.signData({ items })` |
| Issue | `issueCredentials([...])`; the user approves in an extension window; `IssuanceFailure.issued` on failure |
| Credential CESR | `refetchCredentialCesr(said)` |
| Raw message | `client.sendMessage(type, { payload })` |
