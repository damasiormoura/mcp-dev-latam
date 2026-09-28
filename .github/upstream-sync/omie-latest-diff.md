# Upstream changes in `packages/erp/omie`

Comparing `codespar/mcp-dev-latam@1b2a0ee347a4` → `codespar/mcp-dev-latam@d0a519ad3ce1`.

This PR does **not** touch this fork's copy of `packages/erp/omie` and does not
merge automatically. It only reports what changed upstream since the last
review, so a human can decide what (if anything) to port into this fork's
already-patched, security-reviewed copy — and re-run the security audit
(network destinations, `npm audit`, install scripts) before doing so.

## Commits
```
d0a519a fix(catalog): no dead default hosts; env override for every host; weekly host check (#230)
```

## File diff
```diff
diff --git a/packages/erp/omie/src/index.ts b/packages/erp/omie/src/index.ts
index d242198..2ba7944 100644
--- a/packages/erp/omie/src/index.ts
+++ b/packages/erp/omie/src/index.ts
@@ -66,7 +66,7 @@ const DEMO_RESPONSES: Record<string, unknown> = {
 
 const APP_KEY = process.env.OMIE_APP_KEY || "";
 const APP_SECRET = process.env.OMIE_APP_SECRET || "";
-const BASE_URL = "https://app.omie.com.br/api/v1";
+const BASE_URL = process.env.OMIE_BASE_URL || "https://app.omie.com.br/api/v1";
 
 async function omieRequest(path: string, call: string, param: unknown[]): Promise<unknown> {
   const res = await fetch(`${BASE_URL}${path}`, {
```
