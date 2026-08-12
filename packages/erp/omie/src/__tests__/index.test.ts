import { describe, it, expect, vi, beforeEach } from "vitest";

let listToolsHandler: Function;
let callToolHandler: Function;

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
  class FakeServer {
    constructor() {}
    setRequestHandler(schema: any, handler: Function) {
      if (JSON.stringify(schema).includes("tools/list")) listToolsHandler = handler;
      if (JSON.stringify(schema).includes("tools/call")) callToolHandler = handler;
    }
    connect() { return Promise.resolve(); }
  }
  return { Server: FakeServer };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({ StdioServerTransport: class {} }));

process.env.OMIE_APP_KEY = "test-key";
process.env.OMIE_APP_SECRET = "test-secret";

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

beforeEach(async () => {
  vi.resetModules();
  listToolsHandler = undefined as any;
  callToolHandler = undefined as any;
  mockFetch.mockReset();
  global.fetch = mockFetch as any;
  await import("../index.js");
});

/** Minimum arguments each tool needs to clear schema validation and reach fetch. */
const MIN_ARGS: Record<string, unknown> = {
  create_customer: { cnpj_cpf: "12345678000190", razao_social: "Demo LTDA" },
  create_product: { descricao: "P", codigo: "P1", unidade: "UN", ncm: "1234.56.78", valor_unitario: 1 },
  create_order: {
    cabecalho: {
      codigo_cliente: 1, codigo_pedido_integracao: "PED-1",
      data_previsao: "01/01/2027", etapa: "10", codigo_parcela: "999",
    },
    det: [{ ide: { codigo_item_integracao: "I1" }, produto: { codigo_produto: 2, quantidade: 1, valor_unitario: 10 } }],
    informacoes_adicionais: { codigo_categoria: "1.01.01", codigo_conta_corrente: 3 },
  },
  create_service_order: {
    Cabecalho: { cCodIntOS: "OS-1", nCodCli: 1, dDtPrevisao: "01/01/2027", cEtapa: "20" },
    InformacoesAdicionais: { cCodCateg: "1.01.02", nCodCC: 3 },
    ServicosPrestados: [{ nCodServico: 9, nQtde: 1, nValUnit: 100 }],
  },
  create_purchase_order: {
    cabecalho_incluir: { cCodIntPed: "PC-1", dDtPrevisao: "01/01/2027", nCodFor: 5 },
    produtos_incluir: [{ cCodIntItem: "I1", nCodProd: 2, nQtde: 1, nValUnit: 10 }],
  },
  create_account_payable: {
    codigo_lancamento_integracao: "AP-1", codigo_cliente_fornecedor: 5,
    data_vencimento: "01/01/2027", valor_documento: 100, codigo_categoria: "2.04.01",
  },
  pay_account_payable: { codigo_baixa: 1, valor: 100, data: "01/01/2027", codigo_conta_corrente: 3 },
  get_bank_statement: { dPeriodoInicial: "01/01/2027", dPeriodoFinal: "31/01/2027" },
  create_cash_entry: {
    cCodIntLanc: "CC-1",
    cabecalho: { nCodCC: 3, dDtLanc: "01/01/2027", nValorLanc: 100 },
  },
  create_stock_adjustment: {
    id_prod: 2, data: "01/01/2027", tipo: "SLD", origem: "AJU",
    motivo: "INV", quan: 5, valor: 10, obs: "inventory",
  },
  update_sales_order: { cabecalho: { codigo_pedido: 1 } },
};

/**
 * The contract every tool is expected to speak. Verified against the reference
 * Omie publishes per endpoint at https://app.omie.com.br/api/v1/<path>/ — the
 * two purchase-order entries in particular used to name methods that do not
 * exist there.
 */
const CONTRACT: Record<string, { path: string; call: string }> = {
  list_customers: { path: "/geral/clientes/", call: "ListarClientes" },
  create_customer: { path: "/geral/clientes/", call: "IncluirCliente" },
  list_products: { path: "/geral/produtos/", call: "ListarProdutos" },
  create_product: { path: "/geral/produtos/", call: "IncluirProduto" },
  create_order: { path: "/produtos/pedido/", call: "IncluirPedido" },
  list_orders: { path: "/produtos/pedido/", call: "ListarPedidos" },
  list_invoices: { path: "/produtos/nfconsultar/", call: "ListarNF" },
  get_financial: { path: "/financas/contareceber/", call: "ListarContasReceber" },
  create_invoice: { path: "/produtos/nfconsultar/", call: "ConsultarNF" },
  get_company_info: { path: "/geral/empresas/", call: "ListarEmpresas" },
  create_service_order: { path: "/servicos/os/", call: "IncluirOS" },
  list_service_orders: { path: "/servicos/os/", call: "ListarOS" },
  create_purchase_order: { path: "/produtos/pedidocompra/", call: "IncluirPedCompra" },
  list_purchase_orders: { path: "/produtos/pedidocompra/", call: "PesquisarPedCompra" },
  get_bank_accounts: { path: "/geral/contacorrente/", call: "ListarContasCorrentes" },
  create_account_payable: { path: "/financas/contapagar/", call: "IncluirContaPagar" },
  list_accounts_payable: { path: "/financas/contapagar/", call: "ListarContasPagar" },
  pay_account_payable: { path: "/financas/contapagar/", call: "LancarPagamento" },
  list_dre: { path: "/geral/dre/", call: "ListarCadastroDRE" },
  get_bank_statement: { path: "/financas/extrato/", call: "ListarExtrato" },
  list_categories: { path: "/geral/categorias/", call: "ListarCategorias" },
  list_departments: { path: "/geral/departamentos/", call: "ListarDepartamentos" },
  list_projects: { path: "/geral/projetos/", call: "ListarProjetos" },
  create_cash_entry: { path: "/financas/contacorrentelancamentos/", call: "IncluirLancCC" },
  list_financial_movements: { path: "/financas/mf/", call: "ListarMovimentos" },
  create_stock_adjustment: { path: "/estoque/ajuste/", call: "IncluirAjusteEstoque" },
  get_stock_position: { path: "/estoque/consulta/", call: "ListarPosEstoque" },
  update_sales_order: { path: "/produtos/pedido/", call: "AlterarPedidoVenda" },
  get_sales_order: { path: "/produtos/pedido/", call: "ConsultarPedido" },
  invoice_sales_order: { path: "/produtos/pedidovendafat/", call: "FaturarPedidoVenda" },
};

async function call(name: string, args: unknown = {}) {
  mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
  const result = await callToolHandler({ params: { name, arguments: args } });
  const [url, opts] = mockFetch.mock.calls[0] ?? [];
  return { result, url, body: opts ? JSON.parse(opts.body) : undefined };
}

describe("mcp-omie", () => {
  it("should register 30 tools", async () => {
    const result = await listToolsHandler();
    expect(result.tools).toHaveLength(30);
  });

  it("exposes exactly the tools covered by the contract table", async () => {
    const { tools } = await listToolsHandler();
    expect(tools.map((t: any) => t.name).sort()).toEqual(Object.keys(CONTRACT).sort());
  });

  describe.each(Object.entries(CONTRACT))("%s", (name, { path, call: expectedCall }) => {
    it(`POSTs to ${path} calling ${expectedCall}`, async () => {
      const { url, body } = await call(name, MIN_ARGS[name] ?? {});

      expect(url).toBe(`https://app.omie.com.br/api/v1${path}`);
      expect(body.call).toBe(expectedCall);
      expect(body.app_key).toBe("test-key");
      expect(body.app_secret).toBe("test-secret");
      expect(Array.isArray(body.param)).toBe(true);
    });
  });

  describe("param shape of the rewritten write tools", () => {
    it("create_order sends the cabecalho/det/informacoes_adicionais blocks", async () => {
      const { body } = await call("create_order", MIN_ARGS.create_order);
      const param = body.param[0];

      expect(Object.keys(param).sort()).toEqual(["cabecalho", "det", "informacoes_adicionais"]);
      expect(param.cabecalho.etapa).toBe("10");
      expect(param.cabecalho.codigo_parcela).toBe("999");
      expect(param.det[0].produto.valor_unitario).toBe(10);
      expect(param.informacoes_adicionais.codigo_conta_corrente).toBe(3);
      // `itens` was the old, non-existent key for the line items.
      expect(param).not.toHaveProperty("itens");
    });

    it("create_service_order sends the PascalCase blocks", async () => {
      const { body } = await call("create_service_order", MIN_ARGS.create_service_order);
      const param = body.param[0];

      expect(param.Cabecalho.cCodIntOS).toBe("OS-1");
      expect(param.ServicosPrestados[0].nValUnit).toBe(100);
      expect(param.InformacoesAdicionais.nCodCC).toBe(3);
      expect(param).not.toHaveProperty("codigo_cliente");
    });

    it("create_purchase_order sends cabecalho_incluir/produtos_incluir", async () => {
      const { body } = await call("create_purchase_order", MIN_ARGS.create_purchase_order);
      const param = body.param[0];

      expect(param.cabecalho_incluir.nCodFor).toBe(5);
      expect(param.produtos_incluir[0].nValUnit).toBe(10);
      expect(param).not.toHaveProperty("codigo_fornecedor");
    });

    it("list_purchase_orders paginates with nPagina/nRegsPorPagina", async () => {
      const { body } = await call("list_purchase_orders", { lExibirPedidosPendentes: "T" });
      const param = body.param[0];

      expect(param.nPagina).toBe(1);
      expect(param.nRegsPorPagina).toBe(50);
      expect(param.lExibirPedidosPendentes).toBe("T");
      expect(param).not.toHaveProperty("pagina");
      expect(param).not.toHaveProperty("registros_por_pagina");
    });

    it("create_cash_entry keeps cCodIntLanc at the top level", async () => {
      const { body } = await call("create_cash_entry", MIN_ARGS.create_cash_entry);
      const param = body.param[0];

      expect(param.cCodIntLanc).toBe("CC-1");
      expect(param.cabecalho).toEqual({ nCodCC: 3, dDtLanc: "01/01/2027", nValorLanc: 100 });
      expect(param.cabecalho).not.toHaveProperty("cCodIntLanc");
    });

    it("create_stock_adjustment uses the abbreviated field names", async () => {
      const { body } = await call("create_stock_adjustment", MIN_ARGS.create_stock_adjustment);
      const param = body.param[0];

      expect(param).toMatchObject({ id_prod: 2, quan: 5, obs: "inventory", tipo: "SLD", origem: "AJU", motivo: "INV" });
      expect(param).not.toHaveProperty("codigo_produto");
      expect(param).not.toHaveProperty("tipo_ajuste");
      expect(param).not.toHaveProperty("quantidade");
    });

    it("create_invoice identifies the NF by nCodNF, not nIdNF", async () => {
      const { body } = await call("create_invoice", { nCodNF: 42 });

      expect(body.param[0]).toEqual({ nCodNF: 42 });
    });
  });

  describe("argument validation", () => {
    it("rejects a sales order missing the required header fields", async () => {
      const result = await callToolHandler({
        params: { name: "create_order", arguments: { cabecalho: { codigo_cliente: 1 }, det: [], informacoes_adicionais: {} } },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("cabecalho.etapa is required");
      expect(result.content[0].text).toContain("cabecalho.codigo_parcela is required");
      expect(result.content[0].text).toContain("informacoes_adicionais.codigo_categoria is required");
      expect(result.content[0].text).toContain("det must have at least 1 item(s)");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects a stock adjustment missing origem and motivo", async () => {
      const result = await callToolHandler({
        params: { name: "create_stock_adjustment", arguments: { id_prod: 2, data: "01/01/2027", tipo: "ENT", quan: 1, valor: 1, obs: "x" } },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("origem is required");
      expect(result.content[0].text).toContain("motivo is required");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("reports an unknown tool as an error", async () => {
      const result = await callToolHandler({ params: { name: "nope", arguments: {} } });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown tool");
    });
  });
});
