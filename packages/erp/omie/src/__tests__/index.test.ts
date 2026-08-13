import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

/**
 * Minimum arguments each tool needs to clear schema validation and reach fetch.
 * Anything absent here has no required fields.
 */
const MIN_ARGS: Record<string, unknown> = {
  create_customer: { cnpj_cpf: "12345678000190", razao_social: "Demo LTDA" },
  upsert_customer: { cnpj_cpf: "12345678000190" },
  create_product: { descricao: "P", codigo: "P1", unidade: "UN", ncm: "1234.56.78", valor_unitario: 1 },
  upsert_product: { codigo_produto_integracao: "PROD-1" },
  create_order: {
    cabecalho: {
      codigo_cliente: 1, codigo_pedido_integracao: "PED-1",
      data_previsao: "01/01/2027", etapa: "10", codigo_parcela: "999",
    },
    det: [{ ide: { codigo_item_integracao: "I1" }, produto: { codigo_produto: 2, quantidade: 1, valor_unitario: 10 } }],
    informacoes_adicionais: { codigo_categoria: "1.01.01", codigo_conta_corrente: 3 },
  },
  update_sales_order: { cabecalho: { codigo_pedido: 1 } },
  change_order_stage: { codigo_pedido: 1, etapa: "20" },
  simulate_order_taxes: {
    codigo_cliente: 1,
    det_simul: [{ produto_simul: { codigo_produto: 2, quantidade: 1, valor_unitario: 10 } }],
  },
  get_invoice_pdf: { nIdNfe: 99 },
  create_service_order: {
    Cabecalho: { cCodIntOS: "OS-1", nCodCli: 1, dDtPrevisao: "01/01/2027", cEtapa: "20" },
    InformacoesAdicionais: { cCodCateg: "1.01.02", nCodCC: 3 },
    ServicosPrestados: [{ nCodServico: 9, nQtde: 1, nValUnit: 100 }],
  },
  update_service_order: { Cabecalho: { nCodOS: 1 } },
  change_service_order_stage: { nCodOS: 1, cEtapa: "50" },
  create_purchase_order: {
    cabecalho_incluir: { cCodIntPed: "PC-1", dDtPrevisao: "01/01/2027", nCodFor: 5 },
    produtos_incluir: [{ cCodIntItem: "I1", nCodProd: 2, nQtde: 1, nValUnit: 10 }],
  },
  create_account_payable: {
    codigo_lancamento_integracao: "AP-1", codigo_cliente_fornecedor: 5,
    data_vencimento: "01/01/2027", valor_documento: 100, codigo_categoria: "2.04.01",
  },
  pay_account_payable: { codigo_baixa_integracao: "BX-1", valor: 100, data: "01/01/2027", codigo_conta_corrente: 3 },
  cancel_payment: { codigo_baixa: 7 },
  create_account_receivable: {
    codigo_lancamento_integracao: "AR-1", codigo_cliente_fornecedor: 5,
    data_vencimento: "01/01/2027", valor_documento: 100, codigo_categoria: "1.01.01",
  },
  receive_account_receivable: { codigo_lancamento: 1, valor: 100, data: "01/01/2027", codigo_conta_corrente: 3 },
  cancel_receipt: { codigo_baixa: 7 },
  get_bank_statement: { dPeriodoInicial: "01/01/2027", dPeriodoFinal: "31/01/2027" },
  create_cash_entry: {
    cCodIntLanc: "CC-1",
    cabecalho: { nCodCC: 3, dDtLanc: "01/01/2027", nValorLanc: 100 },
  },
  create_pix: { cCodIntPix: "PIX-1", vValor: 50 },
  get_pix_qrcode: { nIdConta: 3 },
  create_stock_adjustment: {
    id_prod: 2, data: "01/01/2027", tipo: "SLD", origem: "AJU",
    motivo: "INV", quan: 5, valor: 10, obs: "inventory",
  },
};

async function call(name: string, args: unknown = {}) {
  mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
  const result = await callToolHandler({ params: { name, arguments: args } });
  const [url, opts] = mockFetch.mock.calls[0] ?? [];
  return { result, url, body: opts ? JSON.parse(opts.body) : undefined };
}

/** The tool definitions are the source of truth for path/call. */
async function loadTools() {
  const { TOOLS } = await import("../tools/index.js");
  return TOOLS;
}

describe("mcp-omie", () => {
  it("registers every declared tool, with unique names", async () => {
    const tools = await loadTools();
    const { tools: listed } = await listToolsHandler();

    expect(listed).toHaveLength(tools.length);
    expect(new Set(listed.map((t: any) => t.name)).size).toBe(listed.length);
    expect(listed.map((t: any) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it("exposes only name/description/inputSchema over the wire", async () => {
    const { tools: listed } = await listToolsHandler();

    for (const tool of listed) {
      expect(Object.keys(tool).sort()).toEqual(["description", "inputSchema", "name"]);
    }
  });

  it("every tool declares a plausible Omie endpoint and method", async () => {
    for (const tool of await loadTools()) {
      expect(tool.path, tool.name).toMatch(/^\/[a-z-]+\/[a-z-]+\/$/);
      expect(tool.call, tool.name).toMatch(/^[A-Z][A-Za-z]+$/);
      expect(tool.inputSchema.type, tool.name).toBe("object");
    }
  });

  it("no listing tool lets an agent exceed Omie's 100-record page cap", async () => {
    for (const tool of await loadTools()) {
      const props = (tool.inputSchema as any).properties ?? {};
      for (const key of ["registros_por_pagina", "nRegPorPagina", "nRegsPorPagina"]) {
        if (props[key]) expect(props[key].maximum, `${tool.name}.${key}`).toBe(100);
      }
    }
  });

  describe("every tool posts to its declared endpoint and method", () => {
    it("dispatches all of them correctly", async () => {
      const tools = await loadTools();

      for (const tool of tools) {
        mockFetch.mockReset();
        const { url, body } = await call(tool.name, MIN_ARGS[tool.name] ?? {});

        expect(url, tool.name).toBe(`https://app.omie.com.br/api/v1${tool.path}`);
        expect(body.call, tool.name).toBe(tool.call);
        expect(body.app_key, tool.name).toBe("test-key");
        expect(body.app_secret, tool.name).toBe("test-secret");
        expect(Array.isArray(body.param), tool.name).toBe(true);
        expect(body.param, tool.name).toHaveLength(1);
      }
    });
  });

  describe("param shape of the tools rewritten in 0.2.3", () => {
    it("create_order sends the cabecalho/det/informacoes_adicionais blocks", async () => {
      const { body } = await call("create_order", MIN_ARGS.create_order);
      const param = body.param[0];

      expect(Object.keys(param).sort()).toEqual(["cabecalho", "det", "informacoes_adicionais"]);
      expect(param.cabecalho.etapa).toBe("10");
      expect(param.det[0].produto.valor_unitario).toBe(10);
      expect(param).not.toHaveProperty("itens");
    });

    it("create_service_order sends the PascalCase blocks", async () => {
      const { body } = await call("create_service_order", MIN_ARGS.create_service_order);

      expect(body.param[0].Cabecalho.cCodIntOS).toBe("OS-1");
      expect(body.param[0]).not.toHaveProperty("codigo_cliente");
    });

    it("create_purchase_order sends cabecalho_incluir/produtos_incluir", async () => {
      const { body } = await call("create_purchase_order", MIN_ARGS.create_purchase_order);

      expect(body.param[0].cabecalho_incluir.nCodFor).toBe(5);
      expect(body.param[0]).not.toHaveProperty("codigo_fornecedor");
    });

    it("list_purchase_orders paginates with nPagina/nRegsPorPagina", async () => {
      const { body } = await call("list_purchase_orders", { lExibirPedidosPendentes: "T" });
      const param = body.param[0];

      expect(param.nPagina).toBe(1);
      expect(param.nRegsPorPagina).toBe(50);
      expect(param.lExibirPedidosPendentes).toBe("T");
      expect(param).not.toHaveProperty("pagina");
    });

    it("create_cash_entry keeps cCodIntLanc at the top level", async () => {
      const { body } = await call("create_cash_entry", MIN_ARGS.create_cash_entry);

      expect(body.param[0].cCodIntLanc).toBe("CC-1");
      expect(body.param[0].cabecalho).not.toHaveProperty("cCodIntLanc");
    });

    it("create_stock_adjustment uses the abbreviated field names", async () => {
      const { body } = await call("create_stock_adjustment", MIN_ARGS.create_stock_adjustment);

      expect(body.param[0]).toMatchObject({ id_prod: 2, quan: 5, obs: "inventory", tipo: "SLD" });
      expect(body.param[0]).not.toHaveProperty("codigo_produto");
      expect(body.param[0]).not.toHaveProperty("tipo_ajuste");
    });

    it("create_invoice identifies the NF by nCodNF, not nIdNF", async () => {
      const { body } = await call("create_invoice", { nCodNF: 42 });

      expect(body.param[0]).toEqual({ nCodNF: 42 });
    });
  });

  /**
   * Audit section 2: these tools declared filter fields that do not exist in
   * the Omie request types. A bad filter is not an error there — the call
   * returns 200 with the filter silently dropped, so the agent reports a
   * recordset that was never narrowed. Each name below was checked against the
   * documented request type for its endpoint.
   */
  describe("filter parameters exist in the Omie contract", () => {
    const FORBIDDEN: Record<string, string[]> = {
      get_financial: ["dDtEmiInicial", "dDtEmiFinal"],
      list_accounts_payable: ["dDtVencDe", "dDtVencAte", "status_titulo"],
      list_service_orders: ["etapa"],
      get_stock_position: ["cExibirTodos"],
      update_sales_order: ["itens"],
    };

    const REQUIRED: Record<string, string[]> = {
      get_financial: ["filtrar_por_emissao_de", "filtrar_por_emissao_ate", "filtrar_por_status"],
      list_accounts_payable: ["filtrar_por_status", "filtrar_por_emissao_de"],
      list_service_orders: ["filtrar_por_etapa", "filtrar_por_status"],
      get_stock_position: ["cExibeTodos"],
      update_sales_order: ["det"],
      list_financial_movements: ["dDtVencDe", "dDtVencAte"],
    };

    it("drops every field the API does not define", async () => {
      const tools = await loadTools();
      for (const [name, fields] of Object.entries(FORBIDDEN)) {
        const props = (tools.find((t) => t.name === name)!.inputSchema as any).properties;
        for (const f of fields) expect(props, `${name}.${f}`).not.toHaveProperty(f);
      }
    });

    it("declares the documented replacements", async () => {
      const tools = await loadTools();
      for (const [name, fields] of Object.entries(REQUIRED)) {
        const props = (tools.find((t) => t.name === name)!.inputSchema as any).properties;
        for (const f of fields) expect(props, `${name}.${f}`).toHaveProperty(f);
      }
    });

    it("cNatureza offers only the two natures the API documents", async () => {
      const tools = await loadTools();
      const props = (tools.find((t) => t.name === "list_financial_movements")!.inputSchema as any).properties;

      expect(props.cNatureza.enum).toEqual(["P", "R"]);
    });

    it("forwards the corrected filters verbatim", async () => {
      const { body } = await call("get_financial", { filtrar_por_emissao_de: "01/01/2027", filtrar_por_status: "ATRASADO" });

      expect(body.param[0]).toMatchObject({
        pagina: 1,
        registros_por_pagina: 50,
        filtrar_por_emissao_de: "01/01/2027",
        filtrar_por_status: "ATRASADO",
      });
    });
  });

  describe("pay_account_payable settlement contract", () => {
    it("types codigo_baixa as the Omie integer and exposes the integration code separately", async () => {
      const tools = await loadTools();
      const props = (tools.find((t) => t.name === "pay_account_payable")!.inputSchema as any).properties;

      expect(props.codigo_baixa.type).toBe("number");
      expect(props.codigo_baixa_integracao.type).toBe("string");
      expect(props).toHaveProperty("juros");
      expect(props).toHaveProperty("desconto");
      expect(props).toHaveProperty("multa");
    });

    it("no longer requires codigo_baixa, which the caller cannot know", async () => {
      const tools = await loadTools();
      const schema = tools.find((t) => t.name === "pay_account_payable")!.inputSchema as any;

      expect(schema.required).not.toContain("codigo_baixa");
      expect(schema.required).toEqual(expect.arrayContaining(["valor", "data", "codigo_conta_corrente"]));
    });
  });

  describe("pagination defaults", () => {
    it("applies snake-case defaults without clobbering an explicit page", async () => {
      const { body } = await call("list_customers", { pagina: 3 });

      expect(body.param[0]).toMatchObject({ pagina: 3, registros_por_pagina: 50 });
    });

    it("applies the nPagina/nRegPorPagina spelling where the endpoint wants it", async () => {
      const { body } = await call("list_stock_locations", {});

      expect(body.param[0]).toEqual({ nPagina: 1, nRegPorPagina: 50 });
    });

    it("list_dre still defaults apenasContasAtivas to S", async () => {
      const { body } = await call("list_dre", {});

      expect(body.param[0]).toEqual({ apenasContasAtivas: "S" });
    });
  });

  describe("demo mode", () => {
    beforeEach(async () => {
      process.env.MCP_DEMO = "true";
      vi.resetModules();
      listToolsHandler = undefined as any;
      callToolHandler = undefined as any;
      mockFetch.mockReset();
      await import("../index.js");
    });

    afterEach(() => {
      delete process.env.MCP_DEMO;
    });

    it("never touches the network, even for a curated response", async () => {
      const result = await callToolHandler({ params: { name: "list_customers", arguments: {} } });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(JSON.parse(result.content[0].text)).toHaveProperty("clientes_cadastro");
    });

    it("still runs schema validation before returning a response", async () => {
      const result = await callToolHandler({
        params: { name: "create_order", arguments: { cabecalho: {}, det: [], informacoes_adicionais: {} } },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("is required");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("falls back to echoing the validated, defaulted arguments for a tool with no curated example", async () => {
      const result = await callToolHandler({ params: { name: "list_salespeople", arguments: { pagina: 2 } } });
      const body = JSON.parse(result.content[0].text);

      expect(body.demo).toBe(true);
      expect(body.tool).toBe("list_salespeople");
      expect(body.would_send).toMatchObject({ pagina: 2, registros_por_pagina: 50 });
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

    it("rejects a PIX charge with no integration code", async () => {
      const result = await callToolHandler({ params: { name: "create_pix", arguments: { vValor: 10 } } });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("cCodIntPix is required");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("reports an unknown tool as an error", async () => {
      const result = await callToolHandler({ params: { name: "nope", arguments: {} } });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown tool");
    });
  });
});
