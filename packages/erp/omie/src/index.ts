#!/usr/bin/env node

/**
 * MCP Server for Omie — Brazilian ERP platform.
 *
 * NOTE: Omie uses JSON-RPC style requests. Every API call is a POST
 * with a JSON body containing: call, app_key, app_secret, and param.
 *
 * Tools are defined declaratively in ./tools, one module per domain, each tool
 * carrying the Omie endpoint and method it maps to. Dispatch below is a lookup
 * over that list rather than a switch, so the endpoint/method pair stays next
 * to the schema it belongs to and the contract test can derive its expectations
 * from the definitions themselves.
 *
 *   tools/customers.ts  tools/products.ts  tools/sales.ts     tools/purchases.ts
 *   tools/services.ts   tools/finance.ts   tools/billing.ts   tools/stock.ts
 *   tools/registry.ts
 *
 * Environment:
 *   OMIE_APP_KEY — Omie app key
 *   OMIE_APP_SECRET — Omie app secret
 *
 * HTTP transport (MCP_HTTP=true / --http):
 *   MCP_PORT — listen port (default 3000)
 *   MCP_AUTH_ISSUER — OIDC issuer; enables OAuth enforcement with the next var
 *   MCP_AUTH_RESOURCE — this server's canonical URL, required in the token `aud`
 *   MCP_INSECURE_HTTP — set to "true" to allow starting HTTP with no auth
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { omieRequest, validateArgs } from "./omie.js";
import { TOOLS, findTool } from "./tools/index.js";

const VERSION = "0.3.0";

const DEMO_MODE = process.argv.includes("--demo") || process.env.MCP_DEMO === "true";

const DEMO_RESPONSES: Record<string, unknown> = {
  create_order: { nCodPed: 12345, cCodIntPed: "PED-DEMO-001", cNumPedido: "001234", dDtPrevisao: "2026-04-15", nValorTotal: 150.00, cStatusPedido: "Faturado", items: [{ cDescricao: "Produto Demo", nQuantidade: 1, nValorUnitario: 150.00 }] },
  list_customers: { clientes_cadastro: [{ codigo_cliente: 1001, razao_social: "Demo Comércio LTDA", cnpj_cpf: "12345678000190", email: "contato@demo.com" }], pagina: 1, total_de_paginas: 1, registros: 1, total_de_registros: 1 },
  create_customer: { codigo_cliente: 1001, codigo_cliente_integracao: "CLI-DEMO-001", codigo_status: "0", descricao_status: "Cliente incluído com sucesso" },
  list_orders: { pedido_venda_produto: [{ cabecalho: { nCodPed: 12345, cNumPedido: "001234", nValorTotal: 150.00, cStatusPedido: "Faturado" } }], pagina: 1, total_de_paginas: 1, registros: 1 },
  list_products: { produto_servico_cadastro: [{ codigo_produto: 2001, descricao: "Produto Demo", valor_unitario: 150.00, codigo: "PROD-001" }], pagina: 1, total_de_paginas: 1, registros: 1 },
  get_financial: { conta_receber_cadastro: [{ codigo_lancamento: 3001, valor_documento: 150.00, status_titulo: "Liquidado", data_vencimento: "15/04/2026" }], pagina: 1, total_de_paginas: 1 },
  get_bank_accounts: { ListarContasCorrentes: [{ nCodCC: 4001, cDescricao: "Conta Demo Banco do Brasil", cCodBanco: "001" }] },
  list_payment_terms: { parcela_cadastro: [{ nCodigo: "999", cDescricao: "A vista", nParcelas: 1 }], pagina: 1, total_de_paginas: 1 },
  list_stock_locations: { locais: [{ codigo: 5001, descricao: "Almoxarifado Central" }], nPagina: 1, nTotPaginas: 1 },
};

// ---------------------------------------------------------------------------
// OAuth 2.0 protected-resource support (HTTP transport only).
//
// This server exposes write tools that move money and inventory in a real ERP
// (pay_account_payable, invoice_sales_order, create_stock_adjustment, ...), so
// the HTTP transport must not be reachable without a verified caller.
//
// Both variables must be set to enable enforcement:
//   MCP_AUTH_ISSUER   — OIDC issuer, e.g. https://idp.example.com/realms/mcp
//   MCP_AUTH_RESOURCE — this server's canonical URL, exactly as entered in the
//                       client, e.g. https://mcp.example.com/mcp. Tokens must
//                       carry it in `aud`, which is what stops a token minted
//                       for some other service on the same issuer from being
//                       replayed here.
//
// Unset (the default) leaves the server unauthenticated, which is correct for
// the stdio transport where the OS is the trust boundary — but the HTTP
// transport refuses to start that way unless MCP_AUTH_INSECURE=true is set
// explicitly, so an unprotected deployment can't happen by omission.
// ---------------------------------------------------------------------------
const AUTH_ISSUER = process.env.MCP_AUTH_ISSUER || "";
const AUTH_RESOURCE = process.env.MCP_AUTH_RESOURCE || "";
const AUTH_ENABLED = Boolean(AUTH_ISSUER && AUTH_RESOURCE);

/** Where the protected-resource metadata document lives, derived from the resource URL. */
function metadataUrl(): string {
  const u = new URL(AUTH_RESOURCE);
  return `${u.origin}/.well-known/oauth-protected-resource`;
}

// NOTE: upstream ships a "managed-tier" promotional string here, injected into
// the MCP `instructions` field (sent to the connecting agent on `initialize`),
// pointing at CodeSpar's own hosted service and credential vault. Removed in
// this fork: this deployment only ever talks to app.omie.com.br with locally
// held credentials, and we don't want the agent nudged toward a third-party
// hosted alternative.
const server = new Server(
  { name: "mcp-omie", version: VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs as Record<string, unknown> | undefined) ?? {};

  const tool = findTool(name);
  if (!tool) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }

  const problems = validateArgs(tool.inputSchema, args);
  if (problems.length > 0) {
    return {
      content: [{ type: "text", text: `Invalid arguments for ${name}:\n- ${problems.join("\n- ")}` }],
      isError: true,
    };
  }

  if (DEMO_MODE) {
    return { content: [{ type: "text", text: JSON.stringify(DEMO_RESPONSES[name] || { demo: true, tool: name }, null, 2) }] };
  }

  try {
    const param = tool.param ? tool.param(args) : args;
    const result = await omieRequest(tool.path, tool.call, [param]);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
});

async function main() {
  if (process.argv.includes("--http") || process.env.MCP_HTTP === "true") {
    const { default: express } = await import("express");
    const { randomUUID } = await import("node:crypto");

    if (!AUTH_ENABLED && process.env.MCP_INSECURE_HTTP !== "true") {
      console.error(
        "Refusing to start the HTTP transport without authentication.\n" +
          "This server can create orders, settle payables, issue invoices and adjust\n" +
          "stock in a live ERP; an open /mcp endpoint hands those to anyone who\n" +
          "reaches it. Set MCP_AUTH_ISSUER and MCP_AUTH_RESOURCE to enable OAuth\n" +
          "token verification, or set MCP_INSECURE_HTTP=true if this port is truly\n" +
          "unreachable from anywhere untrusted."
      );
      process.exit(1);
    }

    // Verifies the RFC 9068 access token on each request: signature against the
    // issuer's published JWKS, plus `iss`, `aud` and expiry. jose caches and
    // refreshes the key set, so a key rotation at the IdP is picked up without
    // a restart.
    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

    async function getJwks() {
      if (!jwks) {
        const res = await fetch(`${AUTH_ISSUER}/.well-known/openid-configuration`);
        if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
        const meta = (await res.json()) as { jwks_uri?: string };
        if (!meta.jwks_uri) throw new Error("OIDC discovery document has no jwks_uri");
        jwks = createRemoteJWKSet(new URL(meta.jwks_uri));
      }
      return jwks;
    }

    // A 401 carrying `WWW-Authenticate` is what tells the client where to
    // authenticate. It must be a 401 — clients ignore the header on a 200, and
    // a tool-level error would look like a working server that just failed.
    function unauthorized(res: any, description?: string) {
      const params = [`resource_metadata="${metadataUrl()}"`];
      if (description) params.push(`error="invalid_token"`, `error_description="${description}"`);
      res.set("WWW-Authenticate", `Bearer ${params.join(", ")}`);
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: description || "Authentication required" },
        id: null,
      });
    }

    async function requireAuth(req: any, res: any): Promise<boolean> {
      if (!AUTH_ENABLED) return true;
      const header = req.headers.authorization;
      if (typeof header !== "string" || !header.startsWith("Bearer ")) {
        unauthorized(res);
        return false;
      }
      try {
        await jwtVerify(header.slice(7), await getJwks(), {
          issuer: AUTH_ISSUER,
          audience: AUTH_RESOURCE,
        });
        return true;
      } catch (err) {
        unauthorized(res, err instanceof Error ? err.message : "Invalid token");
        return false;
      }
    }

    const app = express();
    app.use(express.json());
    const transports = new Map<string, StreamableHTTPServerTransport>();

    // Unauthenticated on purpose: the container healthcheck calls it, and it
    // discloses nothing but liveness and a session count.
    app.get("/health", (_req: any, res: any) => res.json({ status: "ok", sessions: transports.size }));

    if (AUTH_ENABLED) {
      // RFC 9728 protected resource metadata. Served at both the bare path and
      // the path-suffixed form, since clients probe
      // /.well-known/oauth-protected-resource/<mcp path> first.
      const metadata = {
        resource: AUTH_RESOURCE,
        authorization_servers: [AUTH_ISSUER],
        bearer_methods_supported: ["header"],
      };
      const serveMetadata = (_req: any, res: any) => res.json(metadata);
      app.get("/.well-known/oauth-protected-resource", serveMetadata);
      app.get("/.well-known/oauth-protected-resource/{*path}", serveMetadata);
    }

    // Sessions live in this process's memory, so every restart or redeploy
    // invalidates the session IDs clients are holding. The Streamable HTTP
    // spec covers exactly this: an unknown Mcp-Session-Id must answer 404, and
    // a client receiving 404 starts a fresh session with a new initialize
    // request. Answering 400 instead (as this did) reads as a malformed
    // request, so clients surface an error rather than reconnecting.
    function unknownSession(res: any) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Session not found" },
        id: null,
      });
    }

    app.post("/mcp", async (req: any, res: any) => {
      if (!(await requireAuth(req, res))) return;
      const sid = req.headers["mcp-session-id"] as string | undefined;
      if (sid && transports.has(sid)) { await transports.get(sid)!.handleRequest(req, res, req.body); return; }
      if (sid) { unknownSession(res); return; }
      if (!sid && isInitializeRequest(req.body)) {
        const t = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (id) => { transports.set(id, t); } });
        t.onclose = () => { if (t.sessionId) transports.delete(t.sessionId); };
        const s = new Server({ name: "mcp-omie", version: VERSION }, { capabilities: { tools: {} } }); (server as any)._requestHandlers.forEach((v: any, k: any) => (s as any)._requestHandlers.set(k, v)); (server as any)._notificationHandlers?.forEach((v: any, k: any) => (s as any)._notificationHandlers.set(k, v)); await s.connect(t);
        await t.handleRequest(req, res, req.body); return;
      }
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request" }, id: null });
    });
    app.get("/mcp", async (req: any, res: any) => { if (!(await requireAuth(req, res))) return; const sid = req.headers["mcp-session-id"] as string; if (sid && transports.has(sid)) await transports.get(sid)!.handleRequest(req, res); else unknownSession(res); });
    app.delete("/mcp", async (req: any, res: any) => { if (!(await requireAuth(req, res))) return; const sid = req.headers["mcp-session-id"] as string; if (sid && transports.has(sid)) await transports.get(sid)!.handleRequest(req, res); else unknownSession(res); });
    const port = Number(process.env.MCP_PORT) || 3000;
    app.listen(port, () => {
      console.error(`MCP HTTP server on http://localhost:${port}/mcp`);
      console.error(
        AUTH_ENABLED
          ? `Auth: OAuth bearer required (issuer ${AUTH_ISSUER}, audience ${AUTH_RESOURCE})`
          : "Auth: DISABLED (MCP_INSECURE_HTTP=true) — do not expose this port"
      );
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch(console.error);
