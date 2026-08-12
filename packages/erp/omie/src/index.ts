#!/usr/bin/env node

/**
 * MCP Server for Omie — Brazilian ERP platform.
 *
 * NOTE: Omie uses JSON-RPC style requests. Every API call is a POST
 * with a JSON body containing: call, app_key, app_secret, and param.
 *
 * Tools:
 * - list_customers: List customers
 * - create_customer: Create a customer
 * - list_products: List products
 * - create_product: Create a product
 * - create_order: Create a sales order
 * - list_orders: List sales orders
 * - list_invoices: List invoices (NF)
 * - get_financial: List accounts receivable
 * - create_invoice: Consult a specific NF
 * - get_company_info: List companies
 * - create_service_order: Create a service order (OS)
 * - list_service_orders: List service orders
 * - create_purchase_order: Create a purchase order
 * - list_purchase_orders: List purchase orders
 * - get_bank_accounts: List registered bank accounts
 * - create_account_payable: Create accounts payable entry (AP)
 * - list_accounts_payable: List accounts payable
 * - pay_account_payable: Settle/record payment on an AP title
 * - list_dre: List DRE (income statement) accounts
 * - get_bank_statement: Bank statement for a period
 * - list_categories: List chart of accounts categories
 * - list_departments: List departments
 * - list_projects: List projects
 * - create_cash_entry: Create a bank account ledger entry (lançamento)
 * - list_financial_movements: List unified financial movements (AP/AR/CC)
 * - create_stock_adjustment: Create an inventory adjustment (entry/exit/balance)
 * - get_stock_position: Get current stock position / balance
 * - update_sales_order: Alter an existing sales order
 * - get_sales_order: Consult a specific sales order
 * - invoice_sales_order: Generate an invoice (NF) from a sales order
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

const DEMO_MODE = process.argv.includes("--demo") || process.env.MCP_DEMO === "true";

const DEMO_RESPONSES: Record<string, unknown> = {
  create_order: { nCodPed: 12345, cCodIntPed: "PED-DEMO-001", cNumPedido: "001234", dDtPrevisao: "2026-04-15", nValorTotal: 150.00, cStatusPedido: "Faturado", items: [{ cDescricao: "Produto Demo", nQuantidade: 1, nValorUnitario: 150.00 }] },
  list_customers: { clientes_cadastro: [{ codigo_cliente: 1001, razao_social: "Demo Comércio LTDA", cnpj_cpf: "12345678000190", email: "contato@demo.com" }], pagina: 1, total_de_paginas: 1, registros: 1, total_de_registros: 1 },
  create_customer: { codigo_cliente: 1001, codigo_cliente_integracao: "CLI-DEMO-001", codigo_status: "0", descricao_status: "Cliente incluído com sucesso" },
  list_orders: { pedido_venda_produto: [{ cabecalho: { nCodPed: 12345, cNumPedido: "001234", nValorTotal: 150.00, cStatusPedido: "Faturado" } }], pagina: 1, total_de_paginas: 1, registros: 1 },
  list_products: { produto_servico_cadastro: [{ codigo_produto: 2001, descricao: "Produto Demo", valor_unitario: 150.00, codigo: "PROD-001" }], pagina: 1, total_de_paginas: 1, registros: 1 },
  get_financial: { conta_receber_cadastro: [{ codigo_lancamento: 3001, valor_documento: 150.00, status_titulo: "Liquidado", data_vencimento: "15/04/2026" }], pagina: 1, total_de_paginas: 1 },
  get_bank_accounts: { ListarContasCorrentes: [{ nCodCC: 4001, cDescricao: "Conta Demo Banco do Brasil", cCodBanco: "001" }] },
};

const APP_KEY = process.env.OMIE_APP_KEY || "";
const APP_SECRET = process.env.OMIE_APP_SECRET || "";
const BASE_URL = "https://app.omie.com.br/api/v1";

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

async function omieRequest(path: string, call: string, param: unknown[]): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      call,
      app_key: APP_KEY,
      app_secret: APP_SECRET,
      param,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Omie API ${res.status}: ${err}`);
  }
  return res.json();
}

// NOTE: upstream ships a "managed-tier" promotional string here, injected into
// the MCP `instructions` field (sent to the connecting agent on `initialize`),
// pointing at CodeSpar's own hosted service and credential vault. Removed in
// this fork: this deployment only ever talks to app.omie.com.br with locally
// held credentials, and we don't want the agent nudged toward a third-party
// hosted alternative.
const server = new Server(
  { name: "mcp-omie", version: "0.2.3" },
  { capabilities: { tools: {} } }
);

const TOOLS = [
    {
      name: "list_customers",
      description: "List customers from Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          pagina: { type: "number", description: "Page number (default 1)" },
          registros_por_pagina: { type: "number", description: "Records per page (default 50)" },
          clientesFiltro: { type: "object", description: "Filter object (nome_fantasia, cnpj_cpf, etc.)" },
        },
      },
    },
    {
      name: "create_customer",
      description: "Create a customer in Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          cnpj_cpf: { type: "string", description: "CPF or CNPJ" },
          razao_social: { type: "string", description: "Legal name" },
          nome_fantasia: { type: "string", description: "Trade name" },
          email: { type: "string", description: "Email address" },
          telefone1_numero: { type: "string", description: "Phone number" },
          endereco: { type: "string", description: "Street address" },
          endereco_numero: { type: "string", description: "Address number" },
          bairro: { type: "string", description: "Neighborhood" },
          cidade: { type: "string", description: "City" },
          estado: { type: "string", description: "State (UF)" },
          cep: { type: "string", description: "Postal code" },
        },
        required: ["cnpj_cpf", "razao_social"],
      },
    },
    {
      name: "list_products",
      description: "List products from Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          pagina: { type: "number", description: "Page number (default 1)" },
          registros_por_pagina: { type: "number", description: "Records per page (default 50)" },
          apenas_importado_api: { type: "string", enum: ["S", "N"], description: "Only API-imported products" },
        },
      },
    },
    {
      name: "create_product",
      description: "Create a product in Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          descricao: { type: "string", description: "Product description" },
          codigo: { type: "string", description: "Product code (internal)" },
          unidade: { type: "string", description: "Unit of measure (UN, KG, etc.)" },
          ncm: { type: "string", description: "NCM code (tax classification)" },
          valor_unitario: { type: "number", description: "Unit price in BRL" },
        },
        required: ["descricao", "codigo", "unidade", "ncm", "valor_unitario"],
      },
    },
    {
      name: "create_order",
      description:
        "Create a sales order in Omie ERP (IncluirPedido). The body mirrors the Omie contract: " +
        "cabecalho + det[] + informacoes_adicionais. Resolve codigo_categoria with list_categories " +
        "and codigo_conta_corrente with get_bank_accounts before calling.",
      inputSchema: {
        type: "object",
        properties: {
          cabecalho: {
            type: "object",
            description: "Order header",
            properties: {
              codigo_cliente: { type: "number", description: "Omie customer ID (codigo_cliente_omie from list_customers)" },
              codigo_pedido_integracao: { type: "string", description: "Integration order code (unique, max 60 chars)" },
              data_previsao: { type: "string", description: "Expected billing date (DD/MM/YYYY)" },
              etapa: { type: "string", description: "Order stage: 00=Orçamento, 10=Pedido, 20=Separar, 50=Faturar, 60=Faturado" },
              codigo_parcela: { type: "string", description: "Payment term code, e.g. \"999\" for a single installment (see /geral/parcelas/ ListarParcelas)" },
              qtde_parcelas: { type: "number", description: "Number of installments; required when codigo_parcela is a multi-installment term" },
              codigo_cenario_impostos: { type: "number", description: "Tax scenario ID; the default scenario is used when omitted" },
              origem_pedido: { type: "string", description: "Order origin, 3 chars (default API)" },
              tipo_desconto_pedido: { type: "string", enum: ["V", "P"], description: "Order-level discount type: V=value, P=percent" },
              valor_desconto_pedido: { type: "number", description: "Order-level discount value" },
              perc_desconto_pedido: { type: "number", description: "Order-level discount percent" },
            },
            required: ["codigo_cliente", "codigo_pedido_integracao", "data_previsao", "etapa", "codigo_parcela"],
          },
          det: {
            type: "array",
            description: "Order line items. Each entry wraps the product in a `produto` object — the price is det[].produto.valor_unitario, not on the item root.",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                ide: {
                  type: "object",
                  properties: {
                    codigo_item_integracao: { type: "string", description: "Integration code for this line (unique within the order)" },
                    simples_nacional: { type: "string", enum: ["S", "N"], description: "Company opted into Simples Nacional" },
                  },
                  required: ["codigo_item_integracao"],
                },
                produto: {
                  type: "object",
                  description: "Product data. Identify the product with codigo_produto (Omie ID) or codigo_produto_integracao — one of the two is required.",
                  properties: {
                    codigo_produto: { type: "number", description: "Omie product ID (from list_products)" },
                    codigo_produto_integracao: { type: "string", description: "Product integration code (alternative to codigo_produto)" },
                    codigo: { type: "string", description: "Product code shown on the order screen" },
                    descricao: { type: "string", description: "Product description" },
                    cfop: { type: "string", description: "CFOP code, e.g. \"5.102\"" },
                    ncm: { type: "string", description: "NCM code (tax classification)" },
                    unidade: { type: "string", description: "Unit of measure (UN, KG, ...)" },
                    quantidade: { type: "number", description: "Quantity" },
                    valor_unitario: { type: "number", description: "Unit price in BRL" },
                    tipo_desconto: { type: "string", enum: ["V", "P"], description: "Item discount type: V=value, P=percent" },
                    valor_desconto: { type: "number", description: "Item discount value" },
                    percentual_desconto: { type: "number", description: "Item discount percent" },
                  },
                  required: ["quantidade", "valor_unitario"],
                },
                inf_adic: {
                  type: "object",
                  description: "Per-item extras",
                  properties: {
                    peso_liquido: { type: "number", description: "Net weight (kg)" },
                    peso_bruto: { type: "number", description: "Gross weight (kg)" },
                    codigo_local_estoque: { type: "number", description: "Warehouse location ID for this item" },
                    dados_adicionais_item: { type: "string", description: "Extra text carried to the invoice" },
                    nao_movimentar_estoque: { type: "string", enum: ["S", "N"], description: "Skip the stock exit when the NF-e is issued" },
                    nao_gerar_financeiro: { type: "string", enum: ["S", "N"], description: "Do not create a receivable for this item" },
                  },
                },
                observacao: {
                  type: "object",
                  properties: { obs_item: { type: "string", description: "Item notes (not printed on the invoice)" } },
                },
              },
              required: ["produto"],
            },
          },
          informacoes_adicionais: {
            type: "object",
            description: "Order-level accounting and billing data",
            properties: {
              codigo_categoria: { type: "string", description: "Category code from the chart of accounts (list_categories)" },
              codigo_conta_corrente: { type: "number", description: "Bank account ID (get_bank_accounts)" },
              consumidor_final: { type: "string", enum: ["S", "N"], description: "Invoice is for a final consumer" },
              enviar_email: { type: "string", enum: ["S", "N"], description: "Email the boleto on billing" },
              numero_pedido_cliente: { type: "string", description: "Customer's own order number" },
              contato: { type: "string", description: "Contact name" },
              dados_adicionais_nf: { type: "string", description: "Additional invoice text" },
              codVend: { type: "number", description: "Salesperson ID" },
              codProj: { type: "number", description: "Project ID" },
            },
            required: ["codigo_categoria", "codigo_conta_corrente"],
          },
          frete: {
            type: "object",
            description: "Shipping details",
            properties: {
              modalidade: { type: "string", description: "Freight mode: 0=CIF (sender), 1=FOB (recipient), 2=third party, 9=no freight" },
              codigo_transportadora: { type: "number", description: "Carrier ID" },
              valor_frete: { type: "number", description: "Freight amount" },
              valor_seguro: { type: "number", description: "Insurance amount" },
              outras_despesas: { type: "number", description: "Other accessory costs" },
              peso_liquido: { type: "number", description: "Net weight (kg)" },
              peso_bruto: { type: "number", description: "Gross weight (kg)" },
              quantidade_volumes: { type: "number", description: "Number of volumes" },
              previsao_entrega: { type: "string", description: "Delivery forecast (DD/MM/YYYY)" },
            },
          },
          lista_parcelas: {
            type: "object",
            description: "Manual installment plan; omit to let codigo_parcela drive it",
            properties: {
              parcela: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    numero_parcela: { type: "number", description: "Installment number" },
                    data_vencimento: { type: "string", description: "Due date (DD/MM/YYYY)" },
                    valor: { type: "number", description: "Installment amount" },
                    percentual: { type: "number", description: "Percent of the order total" },
                    quantidade_dias: { type: "number", description: "Days until due, counted from data_previsao" },
                  },
                  required: ["numero_parcela", "data_vencimento", "valor", "percentual"],
                },
              },
            },
          },
          observacoes: {
            type: "object",
            properties: { obs_venda: { type: "string", description: "Order notes (not shown on the invoice)" } },
          },
        },
        required: ["cabecalho", "det", "informacoes_adicionais"],
      },
    },
    {
      name: "list_orders",
      description: "List sales orders from Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          pagina: { type: "number", description: "Page number (default 1)" },
          registros_por_pagina: { type: "number", description: "Records per page (default 50)" },
          etapa: { type: "string", description: "Order stage filter (10=Pedido, 20=Separar, 50=Faturar, 60=Faturado)" },
        },
      },
    },
    {
      name: "list_invoices",
      description: "List invoices (NF) from Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          pagina: { type: "number", description: "Page number (default 1)" },
          registros_por_pagina: { type: "number", description: "Records per page (default 50)" },
          dEmiInicial: { type: "string", description: "Start emission date (DD/MM/YYYY)" },
          dEmiFinal: { type: "string", description: "End emission date (DD/MM/YYYY)" },
        },
      },
    },
    {
      name: "get_financial",
      description: "List accounts receivable from Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          pagina: { type: "number", description: "Page number (default 1)" },
          registros_por_pagina: { type: "number", description: "Records per page (default 50)" },
          dDtEmiInicial: { type: "string", description: "Start emission date (DD/MM/YYYY)" },
          dDtEmiFinal: { type: "string", description: "End emission date (DD/MM/YYYY)" },
        },
      },
    },
    {
      name: "create_invoice",
      description:
        "Consult a specific NF in Omie ERP (ConsultarNF). Despite the name this reads an invoice, it does not " +
        "issue one — use invoice_sales_order to bill an order. Identify the NF by nCodNF, or by cChaveNFe, " +
        "or by nNF + serie.",
      inputSchema: {
        type: "object",
        properties: {
          nCodNF: { type: "number", description: "Omie NF ID — the primary key, returned as nIdNF by list_invoices" },
          nNF: { type: "string", description: "Fiscal document number (combine with serie)" },
          serie: { type: "string", description: "Fiscal document series" },
          cChaveNFe: { type: "string", description: "44-digit NF-e access key" },
          nIdPedido: { type: "number", description: "ID of the sales order that generated the NF" },
          cnpj_cpf: { type: "string", description: "Customer CNPJ / CPF" },
          tpNF: { type: "string", enum: ["0", "1"], description: "Operation type: 0=inbound, 1=outbound" },
          cDetalhesPedido: { type: "string", enum: ["S", "N"], description: "Include details of the originating order" },
        },
      },
    },
    {
      name: "get_company_info",
      description: "List companies registered in Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          pagina: { type: "number", description: "Page number (default 1)" },
          registros_por_pagina: { type: "number", description: "Records per page (default 50)" },
        },
      },
    },
    {
      name: "create_service_order",
      description:
        "Create a service order (OS) in Omie ERP (IncluirOS). This endpoint uses PascalCase blocks: " +
        "Cabecalho + ServicosPrestados[] + InformacoesAdicionais.",
      inputSchema: {
        type: "object",
        properties: {
          Cabecalho: {
            type: "object",
            description: "Service order header. Identify the customer with nCodCli or cCodIntCli.",
            properties: {
              cCodIntOS: { type: "string", description: "Integration code for the OS (unique)" },
              nCodCli: { type: "number", description: "Omie customer ID (from list_customers)" },
              cCodIntCli: { type: "string", description: "Customer integration code (alternative to nCodCli)" },
              cNumOS: { type: "string", description: "OS number shown to the customer; generated when omitted" },
              dDtPrevisao: { type: "string", description: "Expected date (DD/MM/YYYY)" },
              cEtapa: { type: "string", description: "Stage code: 10, 20, 30, 40, 50=Faturar, 60=Faturado" },
              cCodParc: { type: "string", description: "Payment term code, e.g. \"999\" for a single installment" },
              nQtdeParc: { type: "number", description: "Number of installments" },
              nCodVend: { type: "number", description: "Salesperson ID" },
              nCodCtr: { type: "number", description: "Contract ID — attaches this OS to an existing contract" },
            },
            required: ["cCodIntOS", "dDtPrevisao", "cEtapa"],
          },
          InformacoesAdicionais: {
            type: "object",
            description: "Accounting and billing data for the OS",
            properties: {
              cCodCateg: { type: "string", description: "Category code from the chart of accounts (list_categories)" },
              nCodCC: { type: "number", description: "Bank account ID (get_bank_accounts)" },
              cCidPrestServ: { type: "string", description: "City where the service was rendered, e.g. \"SAO PAULO (SP)\"" },
              cDadosAdicNF: { type: "string", description: "Additional invoice text" },
              cNumPedido: { type: "string", description: "Customer's own order number" },
              cContato: { type: "string", description: "Contact name" },
              nCodProj: { type: "number", description: "Project ID" },
            },
            required: ["cCodCateg", "nCodCC"],
          },
          ServicosPrestados: {
            type: "array",
            description:
              "Services rendered. Reference a registered service with nCodServico (or cCodIntServico) and the " +
              "tax fields are inherited; otherwise cTribServ, cCodServMun, cCodServLC116 and cDescServ are required.",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                nCodServico: { type: "number", description: "Registered service ID (/servicos/servico/)" },
                cCodIntServico: { type: "string", description: "Service integration code (alternative to nCodServico)" },
                cDescServ: { type: "string", description: "Service description" },
                cTribServ: { type: "string", description: "Service taxation type, 2 chars (e.g. \"01\")" },
                cCodServMun: { type: "string", description: "Municipal service code / CNAE" },
                cCodServLC116: { type: "string", description: "LC 116 service code, e.g. \"7.07\"" },
                nQtde: { type: "number", description: "Quantity" },
                nValUnit: { type: "number", description: "Unit price in BRL" },
                cTpDesconto: { type: "string", enum: ["P", "V"], description: "Discount type: P=percent, V=value" },
                nValorDesconto: { type: "number", description: "Discount value" },
                cRetemISS: { type: "string", enum: ["S", "N"], description: "Withhold ISS" },
                cDadosAdicItem: { type: "string", description: "Additional item text" },
                cCodCategItem: { type: "string", description: "Per-item category code" },
                cNaoGerarFinanceiro: { type: "string", enum: ["S", "N"], description: "Do not create a receivable for this item" },
                impostos: {
                  type: "object",
                  description: "Tax rates and withholdings; Omie calculates the amounts",
                  properties: {
                    nAliqISS: { type: "number", description: "ISS rate (%)" },
                    nAliqPIS: { type: "number", description: "PIS rate (%)" },
                    nAliqCOFINS: { type: "number", description: "COFINS rate (%)" },
                    nAliqCSLL: { type: "number", description: "CSLL rate (%)" },
                    nAliqIRRF: { type: "number", description: "IRRF rate (%)" },
                    nAliqINSS: { type: "number", description: "INSS rate (%)" },
                    cRetemPIS: { type: "string", enum: ["S", "N"], description: "Withhold PIS" },
                    cRetemCOFINS: { type: "string", enum: ["S", "N"], description: "Withhold COFINS" },
                    cRetemCSLL: { type: "string", enum: ["S", "N"], description: "Withhold CSLL" },
                    cRetemIRRF: { type: "string", enum: ["S", "N"], description: "Withhold IRRF" },
                    cRetemINSS: { type: "string", enum: ["S", "N"], description: "Withhold INSS" },
                  },
                },
              },
              required: ["nQtde", "nValUnit"],
            },
          },
          Departamentos: {
            type: "array",
            description: "Cost-center split",
            items: {
              type: "object",
              properties: {
                cCodDepto: { type: "string", description: "Department code (list_departments)" },
                nPerc: { type: "number", description: "Percent of the total" },
              },
            },
          },
          Email: {
            type: "object",
            description: "Email delivery options on billing",
            properties: {
              cEnviarPara: { type: "string", description: "Recipient addresses" },
              cEnvBoleto: { type: "string", enum: ["S", "N"], description: "Send the boleto" },
              cEnvLink: { type: "string", enum: ["S", "N"], description: "Send the city-hall NFS-e link" },
              cEnvRecibo: { type: "string", enum: ["S", "N"], description: "Send a receipt instead of the NFS-e" },
            },
          },
          Observacoes: {
            type: "object",
            properties: { cObsOS: { type: "string", description: "OS notes (not shown on the invoice)" } },
          },
        },
        required: ["Cabecalho", "InformacoesAdicionais", "ServicosPrestados"],
      },
    },
    {
      name: "list_service_orders",
      description: "List service orders (OS) from Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          pagina: { type: "number", description: "Page number (default 1)" },
          registros_por_pagina: { type: "number", description: "Records per page (default 50)" },
          etapa: { type: "string", description: "Order stage filter (10=OS, 20=Executar, 50=Faturar, 60=Faturado)" },
        },
      },
    },
    {
      name: "create_purchase_order",
      description:
        "Create a purchase order in Omie ERP (IncluirPedCompra). The body uses the cabecalho_incluir + " +
        "produtos_incluir[] blocks; field names on this endpoint are abbreviated (nCodFor, nQtde, nValUnit).",
      inputSchema: {
        type: "object",
        properties: {
          cabecalho_incluir: {
            type: "object",
            description: "Purchase order header. Identify the supplier with nCodFor, cCodIntFor or cCnpjCpfFor.",
            properties: {
              cCodIntPed: { type: "string", description: "Integration code for the purchase order (unique, max 20 chars)" },
              dDtPrevisao: { type: "string", description: "Expected delivery date (DD/MM/YYYY)" },
              nCodFor: { type: "number", description: "Omie supplier ID (list_customers also returns suppliers)" },
              cCodIntFor: { type: "string", description: "Supplier integration code (alternative to nCodFor)" },
              cCnpjCpfFor: { type: "string", description: "Supplier CNPJ / CPF (alternative to nCodFor and cCodIntFor)" },
              cCodParc: { type: "string", description: "Payment term code, e.g. \"999\" for a single installment" },
              nQtdeParc: { type: "number", description: "Number of installments" },
              cCodCateg: { type: "string", description: "Purchase category code (list_categories)" },
              nCodCC: { type: "number", description: "Bank account ID (get_bank_accounts)" },
              nCodProj: { type: "number", description: "Project ID" },
              nCodCompr: { type: "number", description: "Buyer ID" },
              cContato: { type: "string", description: "Contact at the supplier" },
              cContrato: { type: "string", description: "Purchase contract number" },
              cNumPedido: { type: "string", description: "Order number sent to the supplier" },
              cObs: { type: "string", description: "Notes printed on the order sent to the supplier" },
              cObsInt: { type: "string", description: "Internal notes, not sent to the supplier" },
              cEmailAprovador: { type: "string", description: "Email of the user who approves the order" },
            },
            required: ["cCodIntPed", "dDtPrevisao"],
          },
          produtos_incluir: {
            type: "array",
            description: "Purchase order items. Identify each product with nCodProd or cCodIntProd.",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                cCodIntItem: { type: "string", description: "Integration code for this line" },
                nCodProd: { type: "number", description: "Omie product ID (from list_products)" },
                cCodIntProd: { type: "string", description: "Product integration code (alternative to nCodProd)" },
                cProduto: { type: "string", description: "Product code as it appears on the supplier's invoice" },
                cDescricao: { type: "string", description: "Item description" },
                cNCM: { type: "string", description: "NCM code" },
                cUnidade: { type: "string", description: "Unit of measure" },
                cEAN: { type: "string", description: "EAN / GTIN" },
                nQtde: { type: "number", description: "Quantity" },
                nValUnit: { type: "number", description: "Unit price in BRL" },
                nDesconto: { type: "number", description: "Discount value" },
                nPesoLiq: { type: "number", description: "Net weight (kg)" },
                nPesoBruto: { type: "number", description: "Gross weight (kg)" },
                codigo_local_estoque: { type: "number", description: "Warehouse location ID; defaults to the standard location" },
                cCodCateg: { type: "string", description: "Per-item purchase category code" },
                cObs: { type: "string", description: "Item notes, printed on the order" },
              },
              required: ["nQtde", "nValUnit"],
            },
          },
          frete_incluir: {
            type: "object",
            description: "Freight, transport and accessory costs",
            properties: {
              nCodTransp: { type: "number", description: "Carrier ID" },
              cCodIntTransp: { type: "string", description: "Carrier integration code" },
              cTpFrete: { type: "string", description: "Freight mode: 0=CIF, 1=FOB, 2=third party, 9=no freight" },
              nValFrete: { type: "number", description: "Freight amount" },
              nValSeguro: { type: "number", description: "Insurance amount" },
              nValOutras: { type: "number", description: "Other accessory costs" },
              nQtdVol: { type: "number", description: "Number of volumes" },
              nPesoLiq: { type: "number", description: "Net weight (kg)" },
              nPesoBruto: { type: "number", description: "Gross weight (kg)" },
              cPlaca: { type: "string", description: "Vehicle plate" },
              cUF: { type: "string", description: "Plate state (UF)" },
            },
          },
          departamentos_incluir: {
            type: "array",
            description: "Cost-center split",
            items: {
              type: "object",
              properties: {
                cCodDepto: { type: "string", description: "Department code (list_departments)" },
                nPerc: { type: "number", description: "Percent of the total" },
              },
            },
          },
          parcelas_incluir: {
            type: "array",
            description: "Manual installment plan; omit to let cCodParc drive it",
            items: {
              type: "object",
              properties: {
                nParcela: { type: "number", description: "Installment number" },
                dVencto: { type: "string", description: "Due date (DD/MM/YYYY)" },
                nValor: { type: "number", description: "Installment amount" },
                nPercent: { type: "number", description: "Percent of the order total" },
                nDias: { type: "number", description: "Days until due, counted from dDtPrevisao" },
                cTipoDoc: { type: "string", description: "Document type (see /geral/tiposdoc/)" },
              },
            },
          },
        },
        required: ["cabecalho_incluir", "produtos_incluir"],
      },
    },
    {
      name: "list_purchase_orders",
      description:
        "List purchase orders from Omie ERP (PesquisarPedCompra). This endpoint has no `etapa` filter and its " +
        "own pagination field names — the stage is selected with the lExibirPedidos* flags, which take \"T\"/\"F\".",
      inputSchema: {
        type: "object",
        properties: {
          nPagina: { type: "number", description: "Page number (default 1)" },
          nRegsPorPagina: { type: "number", description: "Records per page (default 50, max 100)" },
          dDataInicial: { type: "string", description: "Orders from this date (DD/MM/YYYY)" },
          dDataFinal: { type: "string", description: "Orders up to this date (DD/MM/YYYY)" },
          lApenasImportadoApi: { type: "string", enum: ["T", "F"], description: "Only orders imported through this API" },
          lApenasAlterados: { type: "boolean", description: "Only orders changed within the period" },
          lExibirPedidosPendentes: { type: "string", enum: ["T", "F"], description: "Include pending orders" },
          lExibirPedidosFaturados: { type: "string", enum: ["T", "F"], description: "Include orders invoiced by the supplier" },
          lExibirPedidosRecebidos: { type: "string", enum: ["T", "F"], description: "Include received orders" },
          lExibirPedidosCancelados: { type: "string", enum: ["T", "F"], description: "Include cancelled orders" },
          lExibirPedidosEncerrados: { type: "string", enum: ["T", "F"], description: "Include closed orders" },
          lExibirPedidosRecParciais: { type: "string", enum: ["T", "F"], description: "Include partially received orders" },
          lExibirPedidosFatParciais: { type: "string", enum: ["T", "F"], description: "Include partially invoiced orders" },
        },
      },
    },
    {
      name: "get_bank_accounts",
      description: "List registered bank accounts in Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          pagina: { type: "number", description: "Page number (default 1)" },
          registros_por_pagina: { type: "number", description: "Records per page (default 50)" },
        },
      },
    },
    {
      name: "create_account_payable",
      description: "Create an accounts payable (AP) entry in Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          codigo_lancamento_integracao: { type: "string", description: "Integration code (unique)" },
          codigo_cliente_fornecedor: { type: "number", description: "Omie supplier ID" },
          data_vencimento: { type: "string", description: "Due date (DD/MM/YYYY)" },
          valor_documento: { type: "number", description: "Document value in BRL" },
          codigo_categoria: { type: "string", description: "Category code (chart of accounts)" },
          data_previsao: { type: "string", description: "Expected payment date (DD/MM/YYYY)" },
          id_conta_corrente: { type: "number", description: "Bank account ID" },
          numero_documento: { type: "string", description: "Document/invoice number" },
          observacao: { type: "string", description: "Notes" },
        },
        required: ["codigo_lancamento_integracao", "codigo_cliente_fornecedor", "data_vencimento", "valor_documento", "codigo_categoria"],
      },
    },
    {
      name: "list_accounts_payable",
      description: "List accounts payable (AP) titles in Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          pagina: { type: "number", description: "Page number (default 1)" },
          registros_por_pagina: { type: "number", description: "Records per page (default 50)" },
          dDtVencDe: { type: "string", description: "Due date from (DD/MM/YYYY)" },
          dDtVencAte: { type: "string", description: "Due date to (DD/MM/YYYY)" },
          status_titulo: { type: "string", description: "Title status (ABERTO, LIQUIDADO, etc.)" },
        },
      },
    },
    {
      name: "pay_account_payable",
      description: "Settle / record payment (baixa) for an AP title in Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          codigo_lancamento: { type: "number", description: "Omie AP title ID" },
          codigo_lancamento_integracao: { type: "string", description: "Integration code (alternative to codigo_lancamento)" },
          codigo_baixa: { type: "string", description: "Settlement integration code (unique)" },
          valor: { type: "number", description: "Paid amount in BRL" },
          data: { type: "string", description: "Payment date (DD/MM/YYYY)" },
          codigo_conta_corrente: { type: "number", description: "Bank account ID used for the payment" },
          observacao: { type: "string", description: "Payment notes" },
        },
        required: ["codigo_baixa", "valor", "data", "codigo_conta_corrente"],
      },
    },
    {
      name: "list_dre",
      description: "List DRE (income statement) chart of accounts in Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          apenasContasAtivas: { type: "string", enum: ["S", "N"], description: "Only active accounts (S/N, default S)" },
        },
      },
    },
    {
      name: "get_bank_statement",
      description: "Retrieve bank account statement (extrato) for a period from Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          nCodCC: { type: "number", description: "Bank account ID" },
          cCodIntCC: { type: "string", description: "Bank account integration code (alternative to nCodCC)" },
          dPeriodoInicial: { type: "string", description: "Start date (DD/MM/YYYY)" },
          dPeriodoFinal: { type: "string", description: "End date (DD/MM/YYYY)" },
          cExibirApenasSaldo: { type: "string", enum: ["S", "N"], description: "Show only balances (S/N)" },
        },
        required: ["dPeriodoInicial", "dPeriodoFinal"],
      },
    },
    {
      name: "list_categories",
      description: "List chart of accounts categories in Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          pagina: { type: "number", description: "Page number (default 1)" },
          registros_por_pagina: { type: "number", description: "Records per page (default 50)" },
        },
      },
    },
    {
      name: "list_departments",
      description: "List departments (cost centers) in Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          pagina: { type: "number", description: "Page number (default 1)" },
          registros_por_pagina: { type: "number", description: "Records per page (default 50)" },
        },
      },
    },
    {
      name: "list_projects",
      description: "List projects in Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          pagina: { type: "number", description: "Page number (default 1)" },
          registros_por_pagina: { type: "number", description: "Records per page (default 50)" },
          apenas_importado_api: { type: "string", enum: ["S", "N"], description: "Only API-imported projects" },
        },
      },
    },
    {
      name: "create_cash_entry",
      description:
        "Create a bank account ledger entry (lançamento de conta corrente) in Omie ERP (IncluirLancCC). " +
        "Note that cCodIntLanc sits at the top level, not inside cabecalho, and that the direction of the " +
        "entry comes from the sign of nValorLanc — there is no cNatureza field.",
      inputSchema: {
        type: "object",
        properties: {
          cCodIntLanc: { type: "string", description: "Integration code for the entry (unique, max 20 chars)" },
          cabecalho: {
            type: "object",
            description: "Entry header — accepts only these three fields",
            properties: {
              nCodCC: { type: "number", description: "Bank account ID (get_bank_accounts)" },
              dDtLanc: { type: "string", description: "Entry date (DD/MM/YYYY)" },
              nValorLanc: { type: "number", description: "Entry amount in BRL; negative for an outflow" },
            },
            required: ["nCodCC", "dDtLanc", "nValorLanc"],
          },
          detalhes: {
            type: "object",
            description: "Entry details",
            properties: {
              cCodCateg: { type: "string", description: "Category code from the chart of accounts (list_categories)" },
              cTipo: { type: "string", description: "Document type: DIN=dinheiro, BOL=boleto, CRT=cartão, CHQ=cheque, CON=convênio, ADI=adiantamento, ..." },
              cNumDoc: { type: "string", description: "Document number" },
              nCodCliente: { type: "number", description: "Customer / payee ID" },
              nCodProjeto: { type: "number", description: "Project ID" },
              cObs: { type: "string", description: "Notes — this is where a free-text history line goes" },
              aCodCateg: {
                type: "array",
                description: "Split across several categories, instead of a single cCodCateg",
                items: {
                  type: "object",
                  properties: {
                    cCodCateg: { type: "string", description: "Category code" },
                    nValor: { type: "number", description: "Amount for this category" },
                    nPerc: { type: "number", description: "Percent for this category" },
                  },
                },
              },
            },
          },
          departamentos: {
            type: "array",
            description: "Cost-center split",
            items: {
              type: "object",
              properties: {
                cCodDep: { type: "string", description: "Department code (list_departments)" },
                nValDep: { type: "number", description: "Amount for this department" },
                nPerDep: { type: "number", description: "Percent for this department" },
              },
            },
          },
          transferencia: {
            type: "object",
            description: "Turns the entry into a transfer between accounts",
            properties: {
              nCodCCDestino: { type: "number", description: "Destination bank account ID" },
            },
          },
        },
        required: ["cCodIntLanc", "cabecalho"],
      },
    },
    {
      name: "list_financial_movements",
      description: "List unified financial movements (AP + AR + CC) in Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          nPagina: { type: "number", description: "Page number (default 1)" },
          nRegPorPagina: { type: "number", description: "Records per page (default 50)" },
          dDtPagtoDe: { type: "string", description: "Payment date from (DD/MM/YYYY)" },
          dDtPagtoAte: { type: "string", description: "Payment date to (DD/MM/YYYY)" },
          cNatureza: { type: "string", enum: ["R", "P", "T"], description: "Nature (R=receivable, P=payable, T=all)" },
          cStatus: { type: "string", description: "Status (ABERTO, LIQUIDADO, VENCIDO, etc.)" },
        },
      },
    },
    {
      name: "create_stock_adjustment",
      description:
        "Create an inventory adjustment (entry/exit/balance/transfer) in Omie ERP (IncluirAjusteEstoque). " +
        "This endpoint uses abbreviated field names (id_prod, quan, obs). Identify the product with id_prod " +
        "or cod_int; every other field listed as required below is mandatory on Omie's side.",
      inputSchema: {
        type: "object",
        properties: {
          id_prod: { type: "number", description: "Omie product ID (from list_products)" },
          cod_int: { type: "string", description: "Product integration code (alternative to id_prod)" },
          cod_int_ajuste: { type: "string", description: "Integration code for this adjustment — send it to keep the operation idempotent" },
          codigo_local_estoque: { type: "number", description: "Warehouse location ID; defaults to the standard location" },
          codigo_local_estoque_destino: { type: "number", description: "Destination warehouse — required when tipo is \"TRF\"" },
          data: { type: "string", description: "Adjustment date (DD/MM/YYYY)" },
          tipo: {
            type: "string",
            enum: ["ENT", "SAI", "SLD", "TRF"],
            description: "Adjustment type: ENT=stock entry, SAI=stock exit, SLD=set the balance, TRF=transfer between locations",
          },
          origem: { type: "string", enum: ["AJU", "PDV"], description: "Movement origin: AJU=manual adjustment, PDV=point of sale" },
          motivo: {
            type: "string",
            description:
              "Reason code, 3 chars, valid values depend on tipo. ENT: INV, OPE, PDV, INI. SAI: INV, PER, OPS, PDV. " +
              "SLD: INV, INI, CMC, PDV. TRF: TRF, TPQ. (INV=inventory, PER=loss/breakage, INI=opening balance, CMC=cost adjustment)",
          },
          quan: { type: "number", description: "Quantity" },
          valor: { type: "number", description: "Movement unit value in BRL" },
          obs: { type: "string", description: "Notes" },
          lote_validade: {
            type: "array",
            description: "Batch / expiry data — required for products under batch control",
            items: {
              type: "object",
              properties: {
                nIdLote: { type: "number", description: "Batch ID — required for batch-controlled products when tipo is not \"ENT\"" },
                nQtdLote: { type: "number", description: "Quantity for this batch" },
                cNumLote: { type: "string", description: "Batch number — only when tipo is \"ENT\" and nIdLote is absent; creates a new batch" },
                cCodAgreg: { type: "string", description: "Batch aggregation code — only when tipo is \"ENT\" and nIdLote is absent" },
                dDataFab: { type: "string", description: "Manufacturing date (DD/MM/YYYY)" },
                dDataVal: { type: "string", description: "Expiry date (DD/MM/YYYY)" },
              },
            },
          },
        },
        required: ["data", "tipo", "origem", "motivo", "quan", "valor", "obs"],
      },
    },
    {
      name: "get_stock_position",
      description: "Get current stock position / balance in Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          nPagina: { type: "number", description: "Page number (default 1)" },
          nRegPorPagina: { type: "number", description: "Records per page (default 50)" },
          dDataPosicao: { type: "string", description: "Position reference date (DD/MM/YYYY)" },
          cExibirTodos: { type: "string", enum: ["S", "N"], description: "Include items with zero stock (S/N)" },
          codigo_local_estoque: { type: "number", description: "Filter by warehouse location ID" },
        },
      },
    },
    {
      name: "update_sales_order",
      description: "Alter an existing sales order in Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          cabecalho: { type: "object", description: "Order header: { codigo_pedido, codigo_pedido_integracao, codigo_cliente, data_previsao, etapa, ... }" },
          itens: { type: "array", description: "Updated order items" },
          observacoes: { type: "object", description: "Order observations" },
          informacoes_adicionais: { type: "object", description: "Additional info (codigo_vendedor, etc.)" },
          frete: { type: "object", description: "Shipping details" },
        },
        required: ["cabecalho"],
      },
    },
    {
      name: "get_sales_order",
      description: "Consult a specific sales order by ID or integration code in Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          codigo_pedido: { type: "number", description: "Omie order ID" },
          codigo_pedido_integracao: { type: "string", description: "Integration order code (alternative)" },
        },
      },
    },
    {
      name: "invoice_sales_order",
      description: "Generate an invoice (NF) from an existing sales order in Omie ERP",
      inputSchema: {
        type: "object",
        properties: {
          nCodPed: { type: "number", description: "Omie order ID" },
          cCodIntPed: { type: "string", description: "Integration order code (alternative)" },
        },
      },
    },
] as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS as unknown as object[] }));

// ---------------------------------------------------------------------------
// Minimal request validation.
//
// The Omie API answers a malformed `param` with an HTTP 500 carrying a
// faultstring, which reaches the agent as an opaque remote failure. Walking the
// tool's own inputSchema first turns "required field missing" into a local,
// actionable message — and, since the schemas below now mirror the documented
// contract, it catches exactly the mistakes that used to reach Omie.
// ---------------------------------------------------------------------------
function validateArgs(schema: any, value: unknown, path = ""): string[] {
  if (!schema || typeof schema !== "object") return [];
  const here = path || "arguments";
  const errors: string[] = [];

  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [`${here} must be an object`];
    }
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (obj[key] === undefined || obj[key] === null) {
        errors.push(`${path ? `${path}.` : ""}${key} is required`);
      }
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (obj[key] !== undefined && obj[key] !== null) {
        errors.push(...validateArgs(sub, obj[key], path ? `${path}.${key}` : key));
      }
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${here} must be an array`];
    if (schema.minItems && value.length < schema.minItems) {
      errors.push(`${here} must have at least ${schema.minItems} item(s)`);
    }
    value.forEach((item, i) => errors.push(...validateArgs(schema.items, item, `${here}[${i}]`)));
  }

  return errors;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = rawArgs as Record<string, unknown> | undefined;

  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }

  const problems = validateArgs(tool.inputSchema, args ?? {});
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
    switch (name) {
      case "list_customers":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/geral/clientes/", "ListarClientes", [{
          pagina: args?.pagina || 1,
          registros_por_pagina: args?.registros_por_pagina || 50,
          ...(args?.clientesFiltro ? { clientesFiltro: args.clientesFiltro } : {}),
        }]), null, 2) }] };
      case "create_customer":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/geral/clientes/", "IncluirCliente", [args || {}]), null, 2) }] };
      case "list_products":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/geral/produtos/", "ListarProdutos", [{
          pagina: args?.pagina || 1,
          registros_por_pagina: args?.registros_por_pagina || 50,
          ...(args?.apenas_importado_api ? { apenas_importado_api: args.apenas_importado_api } : {}),
        }]), null, 2) }] };
      case "create_product":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/geral/produtos/", "IncluirProduto", [args || {}]), null, 2) }] };
      case "create_order":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/produtos/pedido/", "IncluirPedido", [args || {}]), null, 2) }] };
      case "list_orders":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/produtos/pedido/", "ListarPedidos", [{
          pagina: args?.pagina || 1,
          registros_por_pagina: args?.registros_por_pagina || 50,
          ...(args?.etapa ? { etapa: args.etapa } : {}),
        }]), null, 2) }] };
      case "list_invoices":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/produtos/nfconsultar/", "ListarNF", [{
          pagina: args?.pagina || 1,
          registros_por_pagina: args?.registros_por_pagina || 50,
          ...(args?.dEmiInicial ? { dEmiInicial: args.dEmiInicial } : {}),
          ...(args?.dEmiFinal ? { dEmiFinal: args.dEmiFinal } : {}),
        }]), null, 2) }] };
      case "get_financial":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/financas/contareceber/", "ListarContasReceber", [{
          pagina: args?.pagina || 1,
          registros_por_pagina: args?.registros_por_pagina || 50,
          ...(args?.dDtEmiInicial ? { dDtEmiInicial: args.dDtEmiInicial } : {}),
          ...(args?.dDtEmiFinal ? { dDtEmiFinal: args.dDtEmiFinal } : {}),
        }]), null, 2) }] };
      case "create_invoice":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/produtos/nfconsultar/", "ConsultarNF", [args || {}]), null, 2) }] };
      case "get_company_info":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/geral/empresas/", "ListarEmpresas", [{
          pagina: args?.pagina || 1,
          registros_por_pagina: args?.registros_por_pagina || 50,
        }]), null, 2) }] };
      case "create_service_order":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/servicos/os/", "IncluirOS", [args || {}]), null, 2) }] };
      case "list_service_orders":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/servicos/os/", "ListarOS", [{
          pagina: args?.pagina || 1,
          registros_por_pagina: args?.registros_por_pagina || 50,
          ...(args?.etapa ? { etapa: args.etapa } : {}),
        }]), null, 2) }] };
      case "create_purchase_order":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/produtos/pedidocompra/", "IncluirPedCompra", [args || {}]), null, 2) }] };
      case "list_purchase_orders":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/produtos/pedidocompra/", "PesquisarPedCompra", [{
          ...args,
          nPagina: args?.nPagina || 1,
          nRegsPorPagina: args?.nRegsPorPagina || 50,
        }]), null, 2) }] };
      case "get_bank_accounts":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/geral/contacorrente/", "ListarContasCorrentes", [{
          pagina: args?.pagina || 1,
          registros_por_pagina: args?.registros_por_pagina || 50,
        }]), null, 2) }] };
      case "create_account_payable":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/financas/contapagar/", "IncluirContaPagar", [args || {}]), null, 2) }] };
      case "list_accounts_payable":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/financas/contapagar/", "ListarContasPagar", [{
          pagina: args?.pagina || 1,
          registros_por_pagina: args?.registros_por_pagina || 50,
          ...(args?.dDtVencDe ? { dDtVencDe: args.dDtVencDe } : {}),
          ...(args?.dDtVencAte ? { dDtVencAte: args.dDtVencAte } : {}),
          ...(args?.status_titulo ? { status_titulo: args.status_titulo } : {}),
        }]), null, 2) }] };
      case "pay_account_payable":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/financas/contapagar/", "LancarPagamento", [args || {}]), null, 2) }] };
      case "list_dre":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/geral/dre/", "ListarCadastroDRE", [{
          apenasContasAtivas: args?.apenasContasAtivas || "S",
        }]), null, 2) }] };
      case "get_bank_statement":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/financas/extrato/", "ListarExtrato", [{
          ...(args?.nCodCC ? { nCodCC: args.nCodCC } : {}),
          ...(args?.cCodIntCC ? { cCodIntCC: args.cCodIntCC } : {}),
          dPeriodoInicial: args?.dPeriodoInicial,
          dPeriodoFinal: args?.dPeriodoFinal,
          ...(args?.cExibirApenasSaldo ? { cExibirApenasSaldo: args.cExibirApenasSaldo } : {}),
        }]), null, 2) }] };
      case "list_categories":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/geral/categorias/", "ListarCategorias", [{
          pagina: args?.pagina || 1,
          registros_por_pagina: args?.registros_por_pagina || 50,
        }]), null, 2) }] };
      case "list_departments":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/geral/departamentos/", "ListarDepartamentos", [{
          pagina: args?.pagina || 1,
          registros_por_pagina: args?.registros_por_pagina || 50,
        }]), null, 2) }] };
      case "list_projects":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/geral/projetos/", "ListarProjetos", [{
          pagina: args?.pagina || 1,
          registros_por_pagina: args?.registros_por_pagina || 50,
          ...(args?.apenas_importado_api ? { apenas_importado_api: args.apenas_importado_api } : {}),
        }]), null, 2) }] };
      case "create_cash_entry":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/financas/contacorrentelancamentos/", "IncluirLancCC", [args || {}]), null, 2) }] };
      case "list_financial_movements":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/financas/mf/", "ListarMovimentos", [{
          nPagina: args?.nPagina || 1,
          nRegPorPagina: args?.nRegPorPagina || 50,
          ...(args?.dDtPagtoDe ? { dDtPagtoDe: args.dDtPagtoDe } : {}),
          ...(args?.dDtPagtoAte ? { dDtPagtoAte: args.dDtPagtoAte } : {}),
          ...(args?.cNatureza ? { cNatureza: args.cNatureza } : {}),
          ...(args?.cStatus ? { cStatus: args.cStatus } : {}),
        }]), null, 2) }] };
      case "create_stock_adjustment":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/estoque/ajuste/", "IncluirAjusteEstoque", [args || {}]), null, 2) }] };
      case "get_stock_position":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/estoque/consulta/", "ListarPosEstoque", [{
          nPagina: args?.nPagina || 1,
          nRegPorPagina: args?.nRegPorPagina || 50,
          ...(args?.dDataPosicao ? { dDataPosicao: args.dDataPosicao } : {}),
          ...(args?.cExibirTodos ? { cExibirTodos: args.cExibirTodos } : {}),
          ...(args?.codigo_local_estoque ? { codigo_local_estoque: args.codigo_local_estoque } : {}),
        }]), null, 2) }] };
      case "update_sales_order":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/produtos/pedido/", "AlterarPedidoVenda", [args || {}]), null, 2) }] };
      case "get_sales_order":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/produtos/pedido/", "ConsultarPedido", [{
          ...(args?.codigo_pedido ? { codigo_pedido: args.codigo_pedido } : {}),
          ...(args?.codigo_pedido_integracao ? { codigo_pedido_integracao: args.codigo_pedido_integracao } : {}),
        }]), null, 2) }] };
      case "invoice_sales_order":
        return { content: [{ type: "text", text: JSON.stringify(await omieRequest("/produtos/pedidovendafat/", "FaturarPedidoVenda", [{
          ...(args?.nCodPed ? { nCodPed: args.nCodPed } : {}),
          ...(args?.cCodIntPed ? { cCodIntPed: args.cCodIntPed } : {}),
        }]), null, 2) }] };
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
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
        const s = new Server({ name: "mcp-omie", version: "0.2.3" }, { capabilities: { tools: {} } }); (server as any)._requestHandlers.forEach((v: any, k: any) => (s as any)._requestHandlers.set(k, v)); (server as any)._notificationHandlers?.forEach((v: any, k: any) => (s as any)._notificationHandlers.set(k, v)); await s.connect(t);
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
