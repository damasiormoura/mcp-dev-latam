# @codespar/mcp-omie

> MCP server for **Omie** — ERP with customers, products, orders, invoices, and financials

[![npm](https://img.shields.io/npm/v/@codespar/mcp-omie)](https://www.npmjs.com/package/@codespar/mcp-omie)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Quick Start

### Claude Desktop

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "omie": {
      "command": "npx",
      "args": ["-y", "@codespar/mcp-omie"],
      "env": {
        "OMIE_APP_KEY": "your-app-key",
        "OMIE_APP_SECRET": "your-app-secret"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add omie -- npx @codespar/mcp-omie
```

### Cursor / VS Code

Add to `.cursor/mcp.json` or `.vscode/mcp.json`:

```json
{
  "servers": {
    "omie": {
      "command": "npx",
      "args": ["-y", "@codespar/mcp-omie"],
      "env": {
        "OMIE_APP_KEY": "your-app-key",
        "OMIE_APP_SECRET": "your-app-secret"
      }
    }
  }
}
```

## Tools (30)

> Conformance status of each tool against the official Omie API reference:
> [`API-AUDIT.md`](./API-AUDIT.md).

### Breaking change in 0.2.3

Seven tools could not work as shipped — two named Omie methods that do not
exist, and five sent a `param` the API does not accept. Fixing them meant
replacing their input schemas with the documented contract, so calls written
against 0.2.2 need updating:

| Tool | Was | Now |
|---|---|---|
| `create_order` | flat `codigo_cliente`, `data_previsao`, `itens` | `cabecalho` + `det[]` + `informacoes_adicionais` |
| `create_service_order` | flat `codigo_cliente`, `servicos` | `Cabecalho` + `ServicosPrestados[]` + `InformacoesAdicionais` |
| `create_purchase_order` | flat `codigo_fornecedor`, `itens` (method `IncluirPedidoCompra`, nonexistent) | `cabecalho_incluir` + `produtos_incluir[]` (method `IncluirPedCompra`) |
| `list_purchase_orders` | `pagina`, `registros_por_pagina`, `etapa` (method `ListarPedidosCompra`, nonexistent) | `nPagina`, `nRegsPorPagina`, `lExibirPedidos*` flags (method `PesquisarPedCompra`) |
| `create_stock_adjustment` | `codigo_produto`, `quantidade`, `tipo_ajuste`, `data_ajuste` | `id_prod`, `quan`, `tipo`, `data`, plus the mandatory `origem` and `obs` |
| `create_cash_entry` | `cCodIntLanc` inside `cabecalho`; `cNatureza`, `cHistorico` | `cCodIntLanc` at the top level; direction comes from the sign of `nValorLanc` |
| `create_invoice` | `nIdNF` | `nCodNF` (or `cChaveNFe`, or `nNF` + `serie`) |

Arguments are now checked against each tool's schema before the request
leaves, so a missing required field returns a local message naming the field
instead of an opaque Omie `500`.

| Tool | Purpose |
|---|---|
| `list_customers` | List customers from Omie ERP |
| `create_customer` | Create a customer in Omie ERP |
| `list_products` | List products from Omie ERP |
| `create_product` | Create a product in Omie ERP |
| `create_order` | Create a sales order in Omie ERP |
| `list_orders` | List sales orders from Omie ERP |
| `list_invoices` | List invoices (NF) from Omie ERP |
| `get_financial` | List accounts receivable from Omie ERP |
| `create_invoice` | Consult a specific NF by ID in Omie ERP |
| `get_company_info` | List companies registered in Omie ERP |
| `create_service_order` | Create a service order (OS) in Omie ERP |
| `list_service_orders` | List service orders (OS) from Omie ERP |
| `create_purchase_order` | Create a purchase order in Omie ERP |
| `list_purchase_orders` | List purchase orders from Omie ERP |
| `get_bank_accounts` | List registered bank accounts in Omie ERP |
| `create_account_payable` | Create an accounts payable (AP) entry in Omie ERP |
| `list_accounts_payable` | List accounts payable (AP) titles in Omie ERP |
| `pay_account_payable` | Settle / record payment (baixa) for an AP title in Omie ERP |
| `list_dre` | List DRE (income statement) chart of accounts in Omie ERP |
| `get_bank_statement` | Retrieve bank account statement (extrato) for a period from Omie ERP |
| `list_categories` | List chart of accounts categories in Omie ERP |
| `list_departments` | List departments (cost centers) in Omie ERP |
| `list_projects` | List projects in Omie ERP |
| `create_cash_entry` | Create a bank account ledger entry (lançamento de conta corrente) in Omie ERP |
| `list_financial_movements` | List unified financial movements (AP + AR + CC) in Omie ERP |
| `create_stock_adjustment` | Create an inventory adjustment (entry/exit/balance) in Omie ERP |
| `get_stock_position` | Get current stock position / balance in Omie ERP |
| `update_sales_order` | Alter an existing sales order in Omie ERP |
| `get_sales_order` | Consult a specific sales order by ID or integration code in Omie ERP |
| `invoice_sales_order` | Generate an invoice (NF) from an existing sales order in Omie ERP |

## Remote (HTTP) transport

Besides stdio, the server can run as a remote MCP server over Streamable HTTP —
which is what you want when the server lives on your own infrastructure and
holds the Omie credentials, rather than running on each user's machine.

```bash
docker build -t mcp-omie packages/erp/omie
docker run -d --name mcp-omie --restart unless-stopped \
  -p 3000:3000 --env-file .env mcp-omie
```

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /mcp` | Bearer token | MCP Streamable HTTP endpoint |
| `GET`/`DELETE /mcp` | Bearer token | Session stream / teardown |
| `GET /health` | none | Liveness + active session count |
| `GET /.well-known/oauth-protected-resource` | none | RFC 9728 metadata, when OAuth is configured |

Sessions are held in memory, so a restart or redeploy invalidates them. The
server answers `404` for an unknown session ID, which tells a spec-compliant
client to open a fresh session on its own.

## Authentication

There are two independent layers, and the HTTP transport needs both.

**1. Omie API credentials.** Omie uses JSON-RPC style requests with `app_key`
and `app_secret` in the request body. These authenticate *this server to Omie*.

**2. OAuth on the HTTP transport.** These authenticate *callers to this server*.
This matters because the tool list is not read-only: `pay_account_payable`,
`invoice_sales_order`, `create_stock_adjustment` and `create_order` move money
and inventory in a live ERP, so an open `/mcp` endpoint hands those to anyone
who can reach it.

Set `MCP_AUTH_ISSUER` and `MCP_AUTH_RESOURCE` and the server will, per request,
verify the bearer token's signature against the issuer's JWKS (discovered via
OIDC discovery, so any standard provider works) along with `iss`, `aud` and
expiry. The `aud` check is the part that stops a token minted for a different
service on the same issuer from being replayed here.

**The HTTP transport exits rather than starting unauthenticated.** If you
genuinely need that — a loopback-only bind, say — set `MCP_INSECURE_HTTP=true`
to say so deliberately. stdio is unaffected either way: there the operating
system is the trust boundary.

## Sandbox / Testing

Omie provides a sandbox via app registration. Create an app to get test credentials.

### Get your credentials

1. Go to [Omie Developer Portal](https://developer.omie.com.br)
2. Create an account
3. Register an application to get app key and secret
4. Set the environment variables

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OMIE_APP_KEY` | Yes | Omie app key |
| `OMIE_APP_SECRET` | Yes | Omie app secret |
| `MCP_HTTP` | HTTP only | `true` to serve Streamable HTTP instead of stdio (same as `--http`) |
| `MCP_PORT` | No | HTTP listen port (default `3000`) |
| `MCP_AUTH_ISSUER` | HTTP only | OIDC issuer that mints access tokens, e.g. `https://idp.example.com/realms/mcp` |
| `MCP_AUTH_RESOURCE` | HTTP only | This server's canonical URL, exactly as entered in the client. Tokens must carry it in `aud` |
| `MCP_INSECURE_HTTP` | No | `true` allows the HTTP transport to start with no auth. Only for a port nothing untrusted can reach |
| `MCP_DEMO` | No | `true` (or `--demo`) returns canned responses without calling Omie |

`MCP_AUTH_ISSUER` and `MCP_AUTH_RESOURCE` are required together: the HTTP
transport refuses to start unless both are set or `MCP_INSECURE_HTTP=true` is.

## Roadmap

### v0.3 (planned)
- `create_production_order` — Create a production order
- `emit_nfe` — Emit NF-e (native emission, not import)
- `reconcile_bank_transaction` — Bank reconciliation matching
- `create_service_contract` — Service contracts CRUD
- `create_custom_field` — Merchant custom fields

Want to contribute? [Open a PR](https://github.com/codespar/mcp-dev-latam) or [request a tool](https://github.com/codespar/mcp-dev-latam/issues).

## Links

- [Omie Website](https://omie.com.br)
- [Omie API Documentation](https://developer.omie.com.br)
- [MCP Dev LATAM](https://github.com/codespar/mcp-dev-latam)
- [Landing Page](https://codespar.dev/mcp)

## Enterprise

Need governance, budget limits, and audit trails for agent payments? [CodeSpar Enterprise](https://codespar.dev/enterprise) adds policy engine, payment routing, and compliance templates on top of these MCP servers.

## License

MIT
