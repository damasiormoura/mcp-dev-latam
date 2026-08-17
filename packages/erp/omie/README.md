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

## Tools (82)

> Conformance status of each tool against the official Omie API reference:
> [`API-AUDIT.md`](./API-AUDIT.md). Every tool carries the Omie method it maps
> to; the contract test pins each pair.

### Customers (6)

| Tool | Omie method | Purpose |
|---|---|---|
| `list_customers` | `ListarClientes` | List customers from Omie ERP |
| `create_customer` | `IncluirCliente` | Create a customer in Omie ERP |
| `get_customer` | `ConsultarCliente` | Consult a single customer in Omie ERP by Omie ID or integration code |
| `update_customer` | `AlterarCliente` | Update an existing customer in Omie ERP |
| `upsert_customer` | `UpsertClienteCpfCnpj` | Create or update a customer in Omie ERP keyed on CNPJ/CPF |
| `list_customers_summary` | `ListarClientesResumido` | List customers in the reduced form — fewer fields per record than list_customers, so it stays within a page budget when scanning a large base |

### Products (5)

| Tool | Omie method | Purpose |
|---|---|---|
| `list_products` | `ListarProdutos` | List products from Omie ERP |
| `create_product` | `IncluirProduto` | Create a product in Omie ERP |
| `get_product` | `ConsultarProduto` | Consult a single product in Omie ERP by Omie ID, integration code or SKU |
| `update_product` | `AlterarProduto` | Update an existing product in Omie ERP |
| `upsert_product` | `UpsertProduto` | Create or update a product in Omie ERP keyed on the integration code |

### Sales orders & invoices (16)

| Tool | Omie method | Purpose |
|---|---|---|
| `create_order` | `IncluirPedido` | Create a sales order in Omie ERP |
| `list_orders` | `ListarPedidos` | List sales orders from Omie ERP |
| `get_sales_order` | `ConsultarPedido` | Consult a specific sales order by ID or integration code in Omie ERP |
| `update_sales_order` | `AlterarPedidoVenda` | Alter an existing sales order in Omie ERP |
| `get_order_status` | `StatusPedido` | Get the processing status of a sales order in Omie ERP — whether it is billed, cancelled, denied or still open |
| `change_order_stage` | `TrocarEtapaPedido` | Move a sales order to another stage in Omie ERP — this is how an order advances from Pedido (10) through Separar (20) to Faturar (50) |
| `simulate_order_taxes` | `SimularImpostos` | Simulate the taxes of a sales order in Omie ERP without creating anything |
| `delete_order` | `ExcluirPedido` | Delete a sales order in Omie ERP |
| `return_order` | `DevolverPedido` | Register a return against a billed sales order in Omie ERP |
| `validate_order` | `ValidarPedidoVenda` | Validate a sales order for billing in Omie ERP without issuing anything |
| `invoice_sales_order` | `FaturarPedidoVenda` | Generate an invoice from an existing sales order in Omie ERP |
| `cancel_order` | `CancelarPedidoVenda` | Cancel a sales order in Omie ERP |
| `list_order_stages` | `ListarEtapasPedido` | List the sales order stages configured for this Omie account |
| `list_invoices` | `ListarNF` | List invoices from Omie ERP |
| `create_invoice` | `ConsultarNF` | Consult a specific NF in Omie ERP |
| `get_invoice_pdf` | `ObterNfe` | Get the download links for an issued NF-e in Omie ERP — the DANFE PDF and the XML |

### Purchasing (3)

| Tool | Omie method | Purpose |
|---|---|---|
| `create_purchase_order` | `IncluirPedCompra` | Create a purchase order in Omie ERP |
| `list_purchase_orders` | `PesquisarPedCompra` | List purchase orders from Omie ERP |
| `get_purchase_order` | `ConsultarPedCompra` | Consult a specific purchase order in Omie ERP |

### Services (OS / NFS-e) (10)

| Tool | Omie method | Purpose |
|---|---|---|
| `create_service_order` | `IncluirOS` | Create a service order in Omie ERP |
| `list_service_orders` | `ListarOS` | List service orders from Omie ERP |
| `get_service_order` | `ConsultarOS` | Consult a specific service order in Omie ERP |
| `update_service_order` | `AlterarOS` | Alter an existing service order in Omie ERP |
| `change_service_order_stage` | `TrocarEtapaOS` | Move a service order to another stage in Omie ERP |
| `validate_service_order` | `ValidarOS` | Validate a service order for billing in Omie ERP without issuing anything |
| `invoice_service_order` | `FaturarOS` | Bill a service order in Omie ERP, issuing the NFS-e — the service-side counterpart of invoice_sales_order |
| `cancel_service_order` | `CancelarOS` | Cancel a service order in Omie ERP |
| `list_services` | `ListarCadastroServico` | List the service catalogue in Omie ERP |
| `list_nfse` | `ListarNFSEs` | List issued service invoices (NFS-e) in Omie ERP |

### Finance — receivables, payables, ledger (20)

| Tool | Omie method | Purpose |
|---|---|---|
| `get_financial` | `ListarContasReceber` | List accounts receivable from Omie ERP |
| `create_account_receivable` | `IncluirContaReceber` | Create an accounts receivable title in Omie ERP — the counterpart of create_account_payable |
| `get_account_receivable` | `ConsultarContaReceber` | Consult a single accounts receivable title in Omie ERP |
| `update_account_receivable` | `AlterarContaReceber` | Update an accounts receivable title in Omie ERP |
| `receive_account_receivable` | `LancarRecebimento` | Settle / record a receipt (baixa) against an AR title in Omie ERP |
| `cancel_receipt` | `CancelarRecebimento` | Cancel a receipt previously settled on an AR title in Omie ERP |
| `create_account_payable` | `IncluirContaPagar` | Create an accounts payable entry in Omie ERP |
| `list_accounts_payable` | `ListarContasPagar` | List accounts payable titles in Omie ERP |
| `get_account_payable` | `ConsultarContaPagar` | Consult a single accounts payable title in Omie ERP |
| `update_account_payable` | `AlterarContaPagar` | Update an accounts payable title in Omie ERP |
| `pay_account_payable` | `LancarPagamento` | Settle / record payment (baixa) for an AP title in Omie ERP |
| `cancel_payment` | `CancelarPagamento` | Cancel a payment previously settled on an AP title in Omie ERP |
| `create_cash_entry` | `IncluirLancCC` | Create a bank account ledger entry (lançamento de conta corrente) in Omie ERP |
| `list_cash_entries` | `ListarLancCC` | List bank account ledger entries in Omie ERP |
| `update_cash_entry` | `AlterarLancCC` | Update a bank account ledger entry in Omie ERP |
| `delete_cash_entry` | `ExcluirLancCC` | Delete a bank account ledger entry in Omie ERP |
| `list_financial_movements` | `ListarMovimentos` | List unified financial movements (AP + AR + CC) in Omie ERP |
| `get_bank_statement` | `ListarExtrato` | Retrieve bank account statement (extrato) for a period from Omie ERP |
| `get_finance_summary` | `ObterResumoFinancas` | Get the consolidated finance position for a day in Omie ERP — balances and totals rather than a title-by-title listing |
| `list_open_titles` | `ObterListaEmAberto` | List the titles still open on a given day in Omie ERP — the collections and payables worklist |

### Billing — PIX & boleto (8)

| Tool | Omie method | Purpose |
|---|---|---|
| `create_pix` | `GerarPix` | Generate a PIX charge in Omie ERP |
| `get_pix_qrcode` | `GerarQrCodePix` | Get the PIX QR code registered for a bank account in Omie ERP |
| `get_pix_status` | `ObterStatusPix` | Check whether a PIX charge has been paid in Omie ERP |
| `list_pix` | `ListarPix` | List PIX charges in Omie ERP |
| `cancel_pix` | `CancelarPix` | Cancel a PIX charge in Omie ERP |
| `generate_boleto` | `GerarBoleto` | Generate a boleto for an accounts receivable title in Omie ERP |
| `get_boleto` | `ObterBoleto` | Get the download link for a boleto already generated in Omie ERP |
| `cancel_boleto` | `CancelarBoleto` | Cancel a boleto in Omie ERP |

### Stock (6)

| Tool | Omie method | Purpose |
|---|---|---|
| `create_stock_adjustment` | `IncluirAjusteEstoque` | Create an inventory adjustment (entry/exit/balance/transfer) in Omie ERP |
| `list_stock_adjustments` | `ListarAjusteEstoque` | List inventory adjustments in Omie ERP |
| `get_stock_position` | `ListarPosEstoque` | Get current stock position / balance in Omie ERP |
| `get_product_stock` | `PosicaoEstoque` | Get the stock position of a single product in Omie ERP — cheaper than paging get_stock_position when you already know the product |
| `list_stock_movements` | `ListarMovimentoEstoque` | List stock movements over a period in Omie ERP — the ledger behind the balances that get_stock_position reports |
| `list_stock_locations` | `ListarLocaisEstoque` | List the warehouse locations configured in Omie ERP |

### Supporting registries (8)

| Tool | Omie method | Purpose |
|---|---|---|
| `get_company_info` | `ListarEmpresas` | List companies registered in Omie ERP |
| `get_bank_accounts` | `ListarContasCorrentes` | List registered bank accounts in Omie ERP |
| `list_categories` | `ListarCategorias` | List chart of accounts categories in Omie ERP |
| `list_departments` | `ListarDepartamentos` | List departments (cost centers) in Omie ERP |
| `list_projects` | `ListarProjetos` | List projects in Omie ERP |
| `list_dre` | `ListarCadastroDRE` | List DRE (income statement) chart of accounts in Omie ERP |
| `list_payment_terms` | `ListarParcelas` | List the payment terms (condições de pagamento / parcelas) configured in Omie ERP |
| `list_salespeople` | `ListarVendedores` | List salespeople registered in Omie ERP |

### Breaking changes

**0.2.3** rewrote seven tools whose payloads the API rejected. Calls written
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

**0.3.0** adds tools only — no existing tool changed its endpoint, method or
accepted arguments.

**0.4.0** corrects filter parameters that the API never accepted. These calls
used to return `200` with the filter silently dropped, so a narrowed request
came back as the full recordset:

| Tool | Removed (not in the API) | Use instead |
|---|---|---|
| `get_financial` | `dDtEmiInicial`, `dDtEmiFinal` | `filtrar_por_emissao_de` / `_ate` |
| `list_accounts_payable` | `dDtVencDe`, `dDtVencAte`, `status_titulo` | `filtrar_por_status`; for due dates use `list_financial_movements` |
| `list_service_orders` | `etapa` | `filtrar_por_etapa` |
| `get_stock_position` | `cExibirTodos` | `cExibeTodos` |
| `update_sales_order` | `itens` | `det` (same shape as `create_order.det`) |
| `list_financial_movements` | `cNatureza: "T"` | omit `cNatureza` for both natures |

`pay_account_payable` also changes: `codigo_baixa` is the integer Omie assigns,
so the caller's own reference now goes in `codigo_baixa_integracao` (string).
It is no longer required — `valor`, `data` and `codigo_conta_corrente` are —
and `juros`, `desconto`, `multa` and `conciliar_documento` are now available.

**0.6.0** enforces the "identify this record via at least one of these
fields" rule that used to live only in a tool's description — a call to
`get_customer`, `pay_account_payable`, `create_purchase_order` or any of the
~35 other affected tools with *none* of the alternative ID fields now fails
locally instead of reaching Omie with nothing to act on. If your integration
was already always sending an identifier, nothing changes; if it was relying
on Omie's own error for a call with no identifier at all, that error now
comes from this server instead, with the same information.

Arguments are checked against each tool's schema before the request leaves, so
a missing required field returns a local message naming the field instead of an
opaque Omie `500`.

**0.6.1** fixes `list_stock_adjustments`, which paginated with
`nPagina`/`nRegPorPagina` while `/estoque/ajuste/` is one of the few `/estoque/`
endpoints that spells it `pagina`/`registros_por_pagina`. Every paginated call
failed with `Tag [NPAGINA] não faz parte da estrutura do tipo complexo
[estoque_mov_listar_request]`.

It also declares search filters that the endpoints have always accepted but the
schemas did not advertise. This matters beyond discoverability: a client that
validates arguments against the declared schema — the claude.ai connector does,
the Claude Code harness does not — rejects an undeclared argument before it ever
reaches the server, so `list_categories` with a `descricao` was a hard error on
one client and a working search on another.

| Tool | Now searchable by |
|---|---|
| `list_categories` | `descricao`, `filtrar_por_tipo`, `filtrar_apenas_ativo` |
| `get_bank_accounts` | `filtrar_por_descricao`, `codigo`, `codigo_integracao` |
| `list_salespeople` | `filtrar_por_nome`, `filtrar_por_email` |
| `list_projects` | `nome_projeto` |
| `list_services` | `cDescricao`, `cCodigo`, `inativo` |
| `list_customers_summary` | `clientesFiltro`, `clientesPorCodigo` |
| `list_orders` | `status_pedido`, `filtrar_por_cliente`, `numero_pedido_*`, billing/cancellation date ranges |
| `list_invoices` | `nIdCliente`, `cnpj_cpf`, `nNFInicial`/`nNFFinal`, `cSerie`, `tpNF`, four more date ranges |
| `list_order_stages` | `nCodPed`, `cEtapa`, `dDtInicial`/`dDtFinal` |
| `list_stock_adjustments` | `id_prod`, `tipo`, `origem`, `motivo`, `data_movimento_*` |
| `list_pix` | `cStatus`, `dEmissaoDe`/`dEmissaoAte` |

Most of these also gain the `filtrar_por_data_de`/`_ate` change-tracking window
and, where the endpoint documents one, a sort key. `list_orders` and
`list_invoices` additionally accept `apenas_resumo` / `cApenasResumo`, which cut
the payload substantially when scanning a period.

`list_salespeople` drops `apenas_importado_api`, which Omie marks DEPRECATED on
`ListarVendedores` (it remains valid on `/geral/projetos/`, `/geral/parcelas/`
and `/estoque/ajuste/`).

Underpinning all of this, `src/__tests__/contract.test.ts` now checks every
tool's declared fields against a committed snapshot of Omie's published request
types, generated by `scripts/omie-doc.py`. It asserts no field is declared that
the request type doesn't contain, none that Omie marks DEPRECATED, and that each
listing paginates with the spelling its own endpoint uses. All three historical
defect classes above — nonexistent methods in 0.2.3, invented filters in 0.4.0,
wrong pagination spelling here — would have failed this test.

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

## Audit trail — who executed what

Every caller over HTTP authenticates as an individual, so the bearer token
names a person. Everything downstream does not: all calls reach Omie under one
shared App Key, so Omie's own history attributes every change to the
integration app, no matter who asked for it.

The server closes that gap from both ends.

**1. An audit log**, one JSON object per tool call, written to stderr and — if
`MCP_AUDIT_LOG` is set — appended to a file:

```json
{"ts":"2026-08-16T10:31:04.220Z","actor":"maria@example.com",
 "caller":{"sub":"f47ac10b-…","email":"maria@example.com","sessionId":"6b1f…"},
 "tool":"pay_account_payable","path":"/financas/contapagar/","call":"LancarPagamento",
 "outcome":"ok","durationMs":412,"args":{"codigo_lancamento":3001,"valor":1500.5},
 "result":{"codigo_baixa":7001},"stamped":true}
```

Every call is recorded, including the ones that never reached Omie — a rejected
settlement attempt is as interesting as a successful one. `result` carries the
identifiers Omie returned, which is what ties a log line to the actual ERP
record. `outcome` is one of `ok`, `error` (Omie refused), `invalid` (this
server refused), `demo`, or `denied` — the last being a request turned away by
the transport before dispatch.

Sessions belong to the identity that opened them: a session ID is just a value
the client sends back, so without that check any valid token could drive
someone else's session and one `sessionId` in the log could cover two people.
A token reaching for a session it does not own gets a `404` and a `denied`
entry — nothing runs, but the attempt is visible.

Arguments are summarised down to identifying and monetary fields rather than
logged whole, so a file that exists to answer "who did this" doesn't accumulate
customer records and tax IDs. `MCP_AUDIT_FULL_ARGS=true` logs them in full.

Because stderr is lost when a container is recreated, point `MCP_AUDIT_LOG` at
a mounted volume if the trail needs to outlive a deploy:

```bash
docker run -d --name mcp-omie \
  -v /var/log/mcp-omie:/var/log/mcp-omie \
  -e MCP_AUDIT_LOG=/var/log/mcp-omie/audit.jsonl \
  … mcp-omie
```

That file grows without bound on its own — the server reopens it on `SIGHUP`
(the same convention nginx and most Unix daemons use), so a standard
`logrotate` config with a `postrotate` hook sending `docker kill --signal=HUP
mcp-omie` rotates it in place with nothing lost. See
[SELF-HOSTING.md](./SELF-HOSTING.md#rotating-the-audit-file) for the config
and why it uses `nocreate` rather than `create`.

**2. Attribution inside Omie.** For write tools that have a free-text notes
field, the caller is appended to it, so someone looking at the record in the
ERP sees who put it there without leaving the ERP:

```
Pedido urgente [via MCP: maria@example.com at 2026-08-16 10:31Z]
```

How far the stamp may go in creating what isn't already there depends on what
it would be creating:

| Case | Behaviour |
|---|---|
| Create, notes block holds only the note | Writes the block and the note |
| Create, notes block also carries business fields (`IncluirLancCC`'s `detalhes`) | Writes the note only if the caller already sent that block — conjuring it would turn "no detail block" into "a detail block with no category", a different request |
| Update (`Alterar*` / `Upsert*`) | Appends only to a value the caller already supplied |

That last row is the one that matters most: Omie replaces the notes it is sent,
so stamping an update that omitted them would erase whatever the record already
had. Losing existing data to record an audit note is a worse outcome than no
note. Set `MCP_AUDIT_STAMP=false` to leave ERP data untouched entirely; the log
is unaffected.

Neither half replaces the other: the log is complete but lives on this side of
the API, and the stamp is visible in Omie but only exists where a notes field
does.

### Attributing to a person in Omie's own history

Both mechanisms are this server's, not Omie's. Omie's native change history
still shows the integration app, because that is what the App Key identifies.
Making Omie itself attribute to a person would mean registering a separate
App Key per user and selecting the credential per request from the verified
token — worth checking against your Omie plan before assuming it's available.

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
| `OMIE_REQUEST_TIMEOUT_MS` | No | Per-request timeout to Omie, in ms (default `20000`) |
| `MCP_SESSION_IDLE_TIMEOUT_MS` | HTTP only | Idle HTTP session eviction, in ms (default `1800000` / 30 min) |
| `MCP_AUDIT_LOG` | No | File to append JSONL audit entries to, in addition to stderr. Use a mounted volume — stderr does not survive `docker rm`. Reopened on `SIGHUP` for logrotate |
| `MCP_AUDIT_FULL_ARGS` | No | `true` logs whole argument objects instead of the identifying/monetary summary |
| `MCP_AUDIT_STAMP` | No | `false` stops appending caller attribution to Omie notes fields |

`MCP_AUTH_ISSUER` and `MCP_AUTH_RESOURCE` are required together: the HTTP
transport refuses to start unless both are set or `MCP_INSECURE_HTTP=true` is.

## Resilience

Omie blocks an IP + App Key + method combination for **30 minutes** (HTTP
425) after 10 consecutive errors — an automated retry policy has to be
careful not to cause the very block it's meant to survive. This server:

- **Only retries read-only calls** (`Listar*`, `Consultar*`, `Obter*`,
  `Pesquisar*`, `Status*`, `Simular*`, `Validar*`). A write's timeout is
  ambiguous — Omie may have already processed it even though no response
  came back — so retrying `create_order`, `pay_account_payable` and the like
  risks a duplicate order or a duplicate payment. They fail on the first
  error instead, every time.
- **Never retries plain HTTP 500.** Omie funnels both transient instability
  and permanent business errors ("cliente não encontrado", a malformed
  field) through that one status code, so retrying it blindly would retry
  the unretryable case too — and spend the same 10-error budget that leads
  to the block. Only network failures, request timeouts, and 502/503/504
  are retried, up to 2 times with exponential backoff and jitter.
- **Never retries HTTP 425** under any circumstance, read or write.
- Every Omie business error is parsed into `{ httpStatus, faultCode,
  faultString }` (`OmieApiError`) instead of a raw JSON string, so the error
  text an agent sees names the actual problem.
- Every request carries a timeout (`OMIE_REQUEST_TIMEOUT_MS`, default 20s)
  so a hung connection can't block a tool call indefinitely.

## Roadmap

### v0.3 (shipped)
52 tools added, taking the server from 30 to 82. The gaps that mattered most:
accounts receivable was read-only (no way to raise or settle a title), service
orders could be created but not billed, and `create_order` demanded a
`codigo_parcela` with no tool to discover a valid one.

### v0.4 (shipped)
Closed the seven filter parameters that didn't exist in the API — those
calls used to return `200` with the filter silently dropped, worse than an
error. See [`API-AUDIT.md`](./API-AUDIT.md) section 2.

### v0.5 (shipped)
Retry/backoff, explicit `HTTP 425` handling, structured `faultstring` /
`faultcode` errors, extended argument validation (scalar types, `enum`,
numeric bounds), a demo-mode fallback that no longer pretends every tool
works, and an HTTP session-handling cleanup (no more reaching into the MCP
SDK's private fields, plus idle-session eviction). See the
[Resilience](#resilience) section above and
[`API-AUDIT.md`](./API-AUDIT.md) section 4.

### v0.6 (shipped)
The two items v0.5 left partial: `anyOfRequired` (a narrow, purpose-built
"identify this record via at least one of these fields" schema check —
not a general JSON Schema `oneOf`) now enforces every "one of two/three ID
fields" rule that used to live only in a tool's description, at 39 places
across 8 modules. Demo mode's curated examples grew from 9 to 22 tools, each
verified against Omie's real response type. See
[`API-AUDIT.md`](./API-AUDIT.md) section 4.5/4.6 for exactly what's covered
and — a few genuinely conditional fields, like `create_invoice`'s `nNF`
needing `serie` — what's deliberately still not.

### v0.7 (shipped)
An audit trail: the bearer token's identity is kept rather than verified and
discarded, so every tool call is logged against the person who made it, and
write tools append that person to the record's notes field inside Omie. Closes
the gap left by one shared App Key, which made every change look like the
integration app regardless of who asked for it. See
[Audit trail](#audit-trail--who-executed-what) above.

A follow-up review of that change caught four defects, all fixed in the same
release: a session was addressable by any valid token, not just the identity
that opened it; one nested notes target could change a request's shape rather
than just its text; the ASCII claim on the stamp was unenforced; and buffered
audit entries could be lost to `docker stop`. The audit file also now reopens
on `SIGHUP`, so `logrotate` can rotate it without losing entries or leaving the
process writing into a renamed file — see
[Rotating the audit file](./SELF-HOSTING.md#rotating-the-audit-file).

Caught live, on first real production traffic after that deploy: the
identifying-field summary matched `cChave*` as a prefix, intending only
`cChaveNFe` (an NF-e access key). `list_customers`' actual response carries
`dadosBancarios.cChavePix` — a customer's PIX key, which can itself be a CPF,
CNPJ, email or phone number depending on what the customer registered. `args`
is shaped by this server's own schemas, but `result` is whatever Omie's
response actually contains, so a prefix match there risks pulling personal
data into the log the same way `cnpj_cpf` was already excluded for. Now
matched by exact name.

### Next
- Per-user Omie App Keys, so Omie's own change history attributes to a person
  rather than to the integration app (depends on the Omie plan allowing more
  than one integration app per tenant)
- `create_production_order` — `/produtos/op/`
- `create_service_contract` — `/servicos/contrato/`
- `reconcile_bank_transaction` — bank reconciliation matching
- CRM (`/crm/*`, 19 endpoints) — currently no coverage at all

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
