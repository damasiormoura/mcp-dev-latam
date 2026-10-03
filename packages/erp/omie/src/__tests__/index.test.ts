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
  pay_account_payable: { codigo_lancamento: 1, codigo_baixa_integracao: "BX-1", valor: 100, data: "01/01/2027", codigo_conta_corrente: 3 },
  cancel_payment: { codigo_baixa: 7 },
  create_account_receivable: {
    codigo_lancamento_integracao: "AR-1", codigo_cliente_fornecedor: 5,
    data_vencimento: "01/01/2027", valor_documento: 100, codigo_categoria: "1.01.01",
  },
  receive_account_receivable: { codigo_lancamento: 1, valor: 100, data: "01/01/2027", codigo_conta_corrente: 3 },
  cancel_receipt: { codigo_baixa: 7 },
  reconcile_receipt: { codigo_baixa: 7 },
  unreconcile_receipt: { codigo_baixa: 7 },
  get_bank_statement: { nCodCC: 3, dPeriodoInicial: "01/01/2027", dPeriodoFinal: "31/01/2027" },
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
  // The remaining entries below identify a record via one of the fields an
  // `anyOfRequired` schema now demands — see the "cross-field identification"
  // describe block for the validation itself.
  get_customer: { codigo_cliente_omie: 1 },
  update_customer: { codigo_cliente_omie: 1 },
  get_product: { codigo_produto: 1 },
  update_product: { codigo_produto: 1 },
  get_sales_order: { codigo_pedido: 1 },
  get_order_status: { codigo_pedido: 1 },
  delete_order: { codigo_pedido: 1 },
  return_order: { codigo_pedido: 1 },
  validate_order: { nCodPed: 1 },
  invoice_sales_order: { nCodPed: 1 },
  cancel_order: { nCodPed: 1 },
  get_purchase_order: { nCodPed: 1 },
  get_service_order: { nCodOS: 1 },
  get_service_order_status: { nCodOS: 1 },
  validate_service_order: { nCodOS: 1 },
  invoice_service_order: { nCodOS: 1 },
  cancel_service_order: { nCodOS: 1, cCancelarNfse: "N" },
  get_account_receivable: { codigo_lancamento_omie: 1 },
  get_account_payable: { codigo_lancamento_omie: 1 },
  update_account_receivable: { codigo_lancamento_omie: 1 },
  update_account_payable: { codigo_lancamento_omie: 1 },
  get_cash_entry: { nCodLanc: 1 },
  update_cash_entry: { cCodIntLanc: "CC-1" },
  delete_cash_entry: { nCodLanc: 1 },
  get_pix_status: { nIdPix: 1 },
  cancel_pix: { nIdPix: 1 },
  generate_boleto: { nCodTitulo: 1 },
  get_boleto: { nCodTitulo: 1 },
  cancel_boleto: { nCodTitulo: 1 },
  extend_boleto: { nCodTitulo: 1, dDtVenc: "01/01/2027" },
  list_open_titles: { cTipo: "R" },
  get_product_stock: { id_prod: 1 },
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

  it("tells the agent the data is live: instructions on initialize, read_at on results, the clause on read tools", async () => {
    const { INSTRUCTIONS, TOOLS: all, isRead } = await import("../tools/index.js");
    expect(INSTRUCTIONS).toMatch(/snapshot/);
    expect(INSTRUCTIONS).toMatch(/call the tool AGAIN/);
    expect(INSTRUCTIONS).toMatch(/confirm with the person/);
    expect(INSTRUCTIONS).toMatch(/REDUNDANT/);
    expect(INSTRUCTIONS).toMatch(/not proof/);
    for (const t of all) {
      expect(/read_at/.test(t.description), `${t.name}`).toBe(isRead(t));
    }
    // A read with a write's name still gets the clause.
    expect(all.find((t) => t.name === "create_invoice")!.description).toMatch(/read_at/);
  });

  it("exposes only name/description/inputSchema/annotations over the wire", async () => {
    const { tools: listed } = await listToolsHandler();

    for (const tool of listed) {
      expect(Object.keys(tool).sort()).toEqual(["annotations", "description", "inputSchema", "name"]);
    }
  });

  it("annotates reads, additive writes and destructive writes from the Omie method", async () => {
    const { tools: listed } = await listToolsHandler();
    const ann = (name: string) => listed.find((t: any) => t.name === name).annotations;

    expect(ann("get_financial")).toMatchObject({ readOnlyHint: true });
    expect(ann("create_invoice")).toMatchObject({ readOnlyHint: true }); // ConsultarNF
    expect(ann("create_order")).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(ann("invoice_sales_order")).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    for (const name of ["cancel_pix", "cancel_account_receivable", "delete_order", "update_customer", "extend_boleto"]) {
      expect(ann(name), name).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    }
    // Reconciling changes the state of an existing settlement rather than adding a record.
    for (const name of ["reconcile_receipt", "unreconcile_receipt"]) {
      expect(ann(name), name).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    }
    for (const name of ["get_cash_entry", "list_unreconciled_entries", "get_service_order_status"]) {
      expect(ann(name), name).toMatchObject({ readOnlyHint: true });
    }
  });

  describe("get_service_order_status", () => {
    it("asks StatusOS on /servicos/os/ with exactly the arguments given", async () => {
      const { url, body } = await call("get_service_order_status", { nCodOS: 5975011809, lMsg: true });

      expect(url).toBe("https://app.omie.com.br/api/v1/servicos/os/");
      expect(body.call).toBe("StatusOS");
      expect(body.param).toEqual([{ nCodOS: 5975011809, lMsg: true }]);
    });

    it("accepts the integration code instead of nCodOS", async () => {
      const { body } = await call("get_service_order_status", { cCodIntOS: "OS-38" });
      expect(body.param[0]).toEqual({ cCodIntOS: "OS-38" });
    });

    it("refuses a call that does not identify the OS, before reaching Omie", async () => {
      const result = await callToolHandler({ params: { name: "get_service_order_status", arguments: { lMsg: true } } });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("at least one of: nCodOS, cCodIntOS");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("refuses lMsg as \"S\": the docs say S/N, the field is boolean", async () => {
      const result = await callToolHandler({ params: { name: "get_service_order_status", arguments: { nCodOS: 1, lMsg: "S" } } });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("lMsg must be a boolean");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("fields whose Omie default is destructive", () => {
    it("cancel_pix keeps the AR title unless lDel is set — Omie's own default deletes it", async () => {
      expect((await call("cancel_pix", { nIdPix: 1 })).body.param[0]).toEqual({ nIdPix: 1, lDel: false });
      mockFetch.mockReset();
      expect((await call("cancel_pix", { nIdPix: 1, lDel: true })).body.param[0]).toEqual({ nIdPix: 1, lDel: true });
    });

    it("cancel_service_order will not cancel an OS without an explicit NFS-e decision", async () => {
      const result = await callToolHandler({ params: { name: "cancel_service_order", arguments: { nCodOS: 1 } } });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("cCancelarNfse is required");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("create_pix requires vValor, as GerarPix does", async () => {
      const result = await callToolHandler({ params: { name: "create_pix", arguments: { cCodIntPix: "P", nCodTitulo: 1 } } });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("vValor is required");
    });

    it("list_financial_movements restricts a status filter to titles unless told otherwise", async () => {
      // Production, 2026-09-27: cNatureza=R + cStatus=ATRASADO without a record
      // type returned the 2 overdue titles plus 7 RECEBIDO settlement rows.
      const sent = async (args: Record<string, unknown>) => {
        mockFetch.mockReset();
        return (await call("list_financial_movements", args)).body.param[0];
      };

      expect(await sent({ cNatureza: "R", cStatus: "ATRASADO" })).toMatchObject({ cTpLancamento: "CR" });
      expect(await sent({ cNatureza: "P", cStatus: "ATRASADO" })).toMatchObject({ cTpLancamento: "CP" });
      expect(await sent({ cStatus: "ATRASADO" })).toMatchObject({ cTpLancamento: "CPCR" });
      expect(await sent({ cNatureza: "R", cStatus: "RECEBIDO", cTpLancamento: "BXCR" })).toMatchObject({ cTpLancamento: "BXCR" });
      expect(await sent({ cNatureza: "R" })).not.toHaveProperty("cTpLancamento");
    });

    it("list_products does not let Omie's PDV-only default hide the catalogue", async () => {
      // Production, 2026-09-27: with filtrar_apenas_omiepdv absent, ListarProdutos
      // returned 0 of 213 products.
      expect((await call("list_products", {})).body.param[0]).toMatchObject({ filtrar_apenas_omiepdv: "N", pagina: 1 });
      mockFetch.mockReset();
      expect((await call("list_products", { filtrar_apenas_omiepdv: "S" })).body.param[0]).toMatchObject({ filtrar_apenas_omiepdv: "S" });
    });

    it("no payment-term description calls 999 a single installment", async () => {
      const text = JSON.stringify((await loadTools()).map((t) => [t.description, t.inputSchema]));
      expect(text).not.toMatch(/999[^"]*single[- ]installment/i);
      expect(text).toContain("informar o número de parcelas");
    });

    it("list_invoices keeps pedido/titulos when the summary and the order details are both asked for", async () => {
      // Production, NF 3993: with both flags Omie returned pedido {} and titulos [].
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ nfCadastro: [{ det: [{ prod: {} }], pedido: { cNumPedido: "8" }, titulos: [{ nValorTitulo: 7800 }], total: {} }] }),
      });
      const result = await callToolHandler({
        params: { name: "list_invoices", arguments: { nNFInicial: 3993, cApenasResumo: "S", cDetalhesPedido: "S" } },
      });

      const sent = JSON.parse(mockFetch.mock.calls[0][1].body).param[0];
      expect(sent).toMatchObject({ cApenasResumo: "N", cDetalhesPedido: "S" });
      const [nf] = JSON.parse(result.content[0].text).nfCadastro;
      expect(nf).not.toHaveProperty("det");
      expect(nf.pedido).toEqual({ cNumPedido: "8" });
      expect(nf.titulos).toHaveLength(1);
    });

    it("list_invoices sends the summary flag untouched on its own", async () => {
      expect((await call("list_invoices", { cApenasResumo: "S" })).body.param[0]).toMatchObject({ cApenasResumo: "S" });
    });

    it("never hands the agent the pre-signed bank-logo URL", async () => {
      const row = { nIdTitulo: 1, vDoc: 652, cUrlLogoBanco: "https://cdn.omie.com.br/x.png?AWSAccessKeyId=AKIA&Signature=abc" };
      for (const name of ["list_open_titles", "get_finance_summary"]) {
        mockFetch.mockReset();
        mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ListaEmEberto: [row], nested: { contas: [row] } }) });
        const result = await callToolHandler({ params: { name, arguments: MIN_ARGS[name] ?? {} } });
        const text = result.content[0].text;
        expect(text, name).not.toContain("AWSAccessKeyId");
        expect(JSON.parse(text).ListaEmEberto[0], name).toMatchObject({ nIdTitulo: 1, vDoc: 652 });
      }
    });

    it("decodes the HTML entities Omie leaves in text", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ produto_servico_cadastro: [{ descricao: "BOBINA ELETROGAS DE 1/2&quot;", valor_unitario: 580 }] }),
      });
      const result = await callToolHandler({ params: { name: "list_products", arguments: {} } });

      expect(JSON.parse(result.content[0].text).produto_servico_cadastro[0]).toEqual({
        descricao: 'BOBINA ELETROGAS DE 1/2"', valor_unitario: 580,
      });
    });

    it("cancel_receipt accepts the settlement integration code as an alternative", async () => {
      const { body } = await call("cancel_receipt", { codigo_baixa_integracao: "BX-1" });
      expect(body.param[0]).toEqual({ codigo_baixa_integracao: "BX-1" });
    });

    it("reconcile_receipt and unreconcile_receipt send only the settlement key", async () => {
      for (const [name, method] of [["reconcile_receipt", "ConciliarRecebimento"], ["unreconcile_receipt", "DesconciliarRecebimento"]]) {
        mockFetch.mockReset();
        const { url, body } = await call(name, { codigo_baixa: 5964359133 });
        expect(url, name).toBe("https://app.omie.com.br/api/v1/financas/contareceber/");
        expect(body.call, name).toBe(method);
        expect(body.param[0], name).toEqual({ codigo_baixa: 5964359133 });
      }
    });

    it("reconcile_receipt refuses a call with no settlement to reconcile", async () => {
      const result = await callToolHandler({ params: { name: "reconcile_receipt", arguments: {} } });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("at least one of: codigo_baixa, codigo_baixa_integracao");
      expect(mockFetch).not.toHaveBeenCalled();
    });
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
        // Multi-step tools read before they write, so their first request is
        // not (path, call); they get their own step-by-step tests below.
        if (tool.run) continue;
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
      const body = JSON.parse(result.content[0].text);
      expect(body).toHaveProperty("clientes_cadastro");
      // Even the curated demo answer is stamped: the agent must see the snapshot time.
      expect(body.read_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
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

    it("uses the curated response — not the fallback — for a section-4.6 addition", async () => {
      const result = await callToolHandler({
        params: { name: "pay_account_payable", arguments: { codigo_lancamento: 1, valor: 100, data: "01/01/2027", codigo_conta_corrente: 3 } },
      });
      const body = JSON.parse(result.content[0].text);

      expect(body.demo).not.toBe(true);
      expect(body).toMatchObject({ codigo_baixa: 7001, codigo_status: "0" });
    });

    it("curates the 22 tools with a verified response type (not the echo fallback)", async () => {
      // DEMO_RESPONSES isn't exported, so this checks indirectly: a curated
      // response never carries the fallback's `demo`/`would_send` markers.
      const curatedNames = [
        "create_order", "list_customers", "create_customer", "list_orders", "list_products",
        "get_financial", "get_bank_accounts", "list_payment_terms", "list_stock_locations",
        "pay_account_payable", "create_account_payable", "receive_account_receivable",
        "create_account_receivable", "get_order_status", "change_order_stage",
        "invoice_sales_order", "validate_order", "create_pix", "get_pix_status",
        "create_stock_adjustment", "create_cash_entry", "create_purchase_order",
      ];
      expect(curatedNames).toHaveLength(22);

      for (const name of curatedNames) {
        const result = await callToolHandler({ params: { name, arguments: MIN_ARGS[name] ?? {} } });
        const body = JSON.parse(result.content[0].text);
        expect(body.demo, name).not.toBe(true);
        expect(body.would_send, name).toBeUndefined();
      }
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

  describe("cross-field identification (anyOfRequired)", () => {
    it("rejects get_customer given neither identifying field", async () => {
      const result = await callToolHandler({ params: { name: "get_customer", arguments: {} } });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "arguments must include at least one of: codigo_cliente_omie, codigo_cliente_integracao"
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("accepts get_customer given only the integration code", async () => {
      const { body } = await call("get_customer", { codigo_cliente_integracao: "CLI-1" });
      expect(body.param[0]).toEqual({ codigo_cliente_integracao: "CLI-1" });
    });

    it("rejects create_order's product identification when det[].produto has neither key", async () => {
      const result = await callToolHandler({
        params: {
          name: "create_order",
          arguments: {
            cabecalho: { codigo_cliente: 1, codigo_pedido_integracao: "P", data_previsao: "01/01/2027", etapa: "10", codigo_parcela: "999" },
            det: [{ produto: { quantidade: 1, valor_unitario: 10 } }],
            informacoes_adicionais: { codigo_categoria: "1.01.01", codigo_conta_corrente: 3 },
          },
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "det[0].produto must include at least one of: codigo_produto, codigo_produto_integracao"
      );
    });

    it("rejects pay_account_payable with a settlement amount but no title to settle", async () => {
      const result = await callToolHandler({
        params: { name: "pay_account_payable", arguments: { valor: 100, data: "01/01/2027", codigo_conta_corrente: 3 } },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "arguments must include at least one of: codigo_lancamento, codigo_lancamento_integracao"
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects create_purchase_order when the supplier can't be identified", async () => {
      const result = await callToolHandler({
        params: {
          name: "create_purchase_order",
          arguments: {
            cabecalho_incluir: { cCodIntPed: "PC-1", dDtPrevisao: "01/01/2027" },
            produtos_incluir: [{ nCodProd: 1, nQtde: 1, nValUnit: 10 }],
          },
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "cabecalho_incluir must include at least one of: nCodFor, cCodIntFor, cCnpjCpfFor"
      );
    });
  });

  /**
   * End to end: from a verified caller in context, through dispatch, to what
   * actually reaches Omie and what lands in the log. The unit tests in
   * audit.test.ts pin the pieces; these pin that they are wired together —
   * which is the part that was missing, since the server verified the token
   * and then discarded it.
   */
  describe("caller attribution", () => {
    const CALLER = { sub: "u-1", email: "heloisa@example.com", username: "heloisa", sessionId: "s-9" };

    /** Reads back the AUDIT lines this server wrote to stderr. */
    function auditLines(spy: ReturnType<typeof vi.spyOn>) {
      return spy.mock.calls
        .map((c) => String(c[0]))
        .filter((line) => line.startsWith("AUDIT "))
        .map((line) => JSON.parse(line.slice("AUDIT ".length)));
    }

    let stderr: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { stderr = vi.spyOn(console, "error").mockImplementation(() => {}); });
    afterEach(() => { stderr.mockRestore(); });

    it("writes the caller into the order sent to Omie, and into the log", async () => {
      const { withCaller } = await import("../audit.js");
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ codigo_pedido: 12345 }) });

      await withCaller(CALLER, () =>
        callToolHandler({ params: { name: "create_order", arguments: MIN_ARGS.create_order } })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.param[0].observacoes.obs_venda).toContain("via MCP: heloisa@example.com");

      const [entry] = auditLines(stderr);
      expect(entry).toMatchObject({
        tool: "create_order",
        call: "IncluirPedido",
        outcome: "ok",
        actor: "heloisa@example.com",
        stamped: true,
        caller: { sub: "u-1", sessionId: "s-9" },
      });
      // The response ID is what ties this line to the order in the ERP.
      expect(entry.result).toMatchObject({ codigo_pedido: 12345 });
    });

    it("logs a failed call against the caller too", async () => {
      const { withCaller } = await import("../audit.js");
      mockFetch.mockResolvedValueOnce({
        ok: false, status: 500,
        text: () => Promise.resolve(JSON.stringify({ faultstring: "Cliente nao encontrado", faultcode: "SOAP-ENV:Client-101" })),
      });

      await withCaller(CALLER, () =>
        callToolHandler({ params: { name: "create_order", arguments: MIN_ARGS.create_order } })
      );

      expect(auditLines(stderr)[0]).toMatchObject({
        outcome: "error",
        actor: "heloisa@example.com",
        tool: "create_order",
      });
      expect(auditLines(stderr)[0].error).toContain("Cliente nao encontrado");
    });

    it("logs a call rejected before it ever reached Omie", async () => {
      const { withCaller } = await import("../audit.js");

      await withCaller(CALLER, () =>
        callToolHandler({ params: { name: "pay_account_payable", arguments: { valor: 1, data: "01/01/2027", codigo_conta_corrente: 3 } } })
      );

      expect(mockFetch).not.toHaveBeenCalled();
      expect(auditLines(stderr)[0]).toMatchObject({
        tool: "pay_account_payable",
        outcome: "invalid",
        actor: "heloisa@example.com",
      });
    });

    it("does not stamp an update that was not already rewriting the notes", async () => {
      const { withCaller } = await import("../audit.js");
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await withCaller(CALLER, () =>
        callToolHandler({ params: { name: "update_sales_order", arguments: { cabecalho: { codigo_pedido: 1 } } } })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.param[0]).not.toHaveProperty("observacoes");
      expect(auditLines(stderr)[0]).toMatchObject({ tool: "update_sales_order", stamped: false });
    });

    it("still runs, unstamped, with no caller — the stdio case", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
      await callToolHandler({ params: { name: "create_order", arguments: MIN_ARGS.create_order } });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.param[0]).not.toHaveProperty("observacoes");
      expect(auditLines(stderr)[0]).toMatchObject({ actor: "unauthenticated", stamped: false });
    });
  });

  /**
   * cancel_account_receivable is the one multi-step tool: read, guard, note,
   * cancel, confirm. The title shapes below are trimmed from the production
   * titles cancelled by hand on 2026-09-27 that motivated it.
   */
  describe("cancel_account_receivable", () => {
    const OPEN_TITLE = {
      codigo_lancamento_omie: 5962280604, codigo_cliente_fornecedor: 5960133581,
      status_titulo: "A VENCER", observacao: "A CANCELAR - título duplicado.",
      data_vencimento: "30/09/2026", valor_documento: 7800,
      boleto: { cGerado: "", cNumBancario: "", cNumBoleto: "" }, codigo_barras_ficha_compensacao: "",
    };
    const WITH_BOLETO = {
      ...OPEN_TITLE, codigo_lancamento_omie: 5962772133, codigo_cliente_fornecedor: 5961454237,
      boleto: { cGerado: "", cNumBancario: "600000020", cNumBoleto: "" },
      codigo_barras_ficha_compensacao: "74891160090000200737543356521005115830000155000",
    };
    const SIBLING = {
      ...WITH_BOLETO, codigo_lancamento_omie: 5962788418, data_vencimento: "28/09/2026", valor_documento: 1550,
      boleto: { cGerado: "S", cNumBancario: "600000020", cNumBoleto: "600000020" },
    };
    const CANCEL_OK = { codigo_lancamento_omie: 5962280604, codigo_status: "0", descricao_status: "Boleto cancelado com sucesso!" };

    function respond(...bodies: unknown[]) {
      for (const b of bodies) mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(b) });
    }
    const sent = () => mockFetch.mock.calls.map(([, opts]) => {
      const body = JSON.parse(opts.body);
      return { call: body.call, param: body.param[0] };
    });
    const run = (args: Record<string, unknown>) =>
      callToolHandler({ params: { name: "cancel_account_receivable", arguments: args } });

    it("reads, notes, cancels and confirms an open title", async () => {
      respond(OPEN_TITLE, {}, CANCEL_OK, { conta_receber_cadastro: [{ ...OPEN_TITLE, status_titulo: "CANCELADO" }] });

      const result = await run({ codigo_lancamento_omie: 5962280604, motivo: "título duplicado" });
      const body = JSON.parse(result.content[0].text);

      expect(result.isError).toBeUndefined();
      expect(sent().map((s) => s.call)).toEqual([
        "ConsultarContaReceber", "AlterarContaReceber", "CancelarContaReceber", "ListarContasReceber",
      ]);
      // The cancel call spells the key chave_lancamento, unlike every other AR method.
      expect(sent()[2].param).toEqual({ chave_lancamento: 5962280604 });
      // Existing notes are kept, the reason appended.
      expect(sent()[1].param).toEqual({
        codigo_lancamento_omie: 5962280604,
        observacao: "A CANCELAR - título duplicado. Cancelamento solicitado: título duplicado.",
      });
      expect(sent()[3].param).toMatchObject({ filtrar_cliente: 5960133581 });
      expect(body.verificacao).toEqual({ status_titulo: "CANCELADO", confirmado: true });
      expect(body.status_anterior).toBe("A VENCER");
    });

    it("stamps the verified caller into the note", async () => {
      const { withCaller } = await import("../audit.js");
      respond(OPEN_TITLE, {}, CANCEL_OK, { conta_receber_cadastro: [] });

      await withCaller({ sub: "u-1", email: "rodrigo@example.com" }, () =>
        run({ codigo_lancamento_omie: 5962280604, motivo: "duplicado" })
      );

      expect(sent()[1].param.observacao).toMatch(/Cancelamento solicitado: duplicado\. \[via MCP: rodrigo@example\.com at /);
    });

    it("does nothing to a title that is already cancelled", async () => {
      respond({ ...OPEN_TITLE, status_titulo: "CANCELADO" });

      const body = JSON.parse((await run({ codigo_lancamento_omie: 5962280604, motivo: "x" })).content[0].text);

      expect(sent()).toHaveLength(1);
      expect(body.ja_cancelado).toBe(true);
    });

    it("refuses a settled title and points at cancel_receipt", async () => {
      respond({ ...OPEN_TITLE, status_titulo: "RECEBIDO" });

      const result = await run({ codigo_lancamento_omie: 5962280604, motivo: "x" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("cancel_receipt");
      expect(sent().map((s) => s.call)).toEqual(["ConsultarContaReceber"]);
    });

    it("refuses a title carrying a boleto, naming the open title that shares it", async () => {
      respond(WITH_BOLETO, { conta_receber_cadastro: [WITH_BOLETO, SIBLING] });

      const result = await run({ codigo_lancamento_omie: 5962772133, motivo: "duplicado" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("600000020");
      expect(result.content[0].text).toContain("SAME boleto: 5962788418");
      expect(result.content[0].text).toContain('confirmar_boleto: "600000020"');
      // Nothing was written.
      expect(sent().map((s) => s.call)).toEqual(["ConsultarContaReceber", "ListarContasReceber"]);
    });

    it("proceeds on a boleto title once the boleto number is echoed back", async () => {
      respond(WITH_BOLETO, {}, { ...CANCEL_OK, codigo_lancamento_omie: 5962772133 }, { conta_receber_cadastro: [] });

      const result = await run({ codigo_lancamento_omie: 5962772133, motivo: "duplicado", confirmar_boleto: "600000020" });

      expect(result.isError).toBeUndefined();
      expect(sent().map((s) => s.call)).toContain("CancelarContaReceber");
    });

    it("rejects a confirmation that does not match the boleto", async () => {
      respond(WITH_BOLETO, { conta_receber_cadastro: [] });

      const result = await run({ codigo_lancamento_omie: 5962772133, motivo: "duplicado", confirmar_boleto: "S" });

      expect(result.isError).toBe(true);
      expect(sent().map((s) => s.call)).not.toContain("CancelarContaReceber");
    });

    it("reports a cancel Omie did not confirm, saying the note was already written", async () => {
      respond(OPEN_TITLE, {}, { codigo_status: "5", descricao_status: "Título bloqueado" });

      const result = await run({ codigo_lancamento_omie: 5962280604, motivo: "x" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Título bloqueado");
      expect(result.content[0].text).toContain("note was already written");
    });

    it("still succeeds when only the confirming listing fails", async () => {
      respond(OPEN_TITLE, {}, CANCEL_OK);
      mockFetch.mockResolvedValueOnce({
        ok: false, status: 500,
        text: () => Promise.resolve(JSON.stringify({ faultstring: "Consumo redundante detectado. Aguarde 30 segundos (REDUNDANT).", faultcode: "SOAP-ENV:Client-6" })),
      });

      const result = await run({ codigo_lancamento_omie: 5962280604, motivo: "x" });
      const body = JSON.parse(result.content[0].text);

      expect(result.isError).toBeUndefined();
      expect(body.verificacao.confirmado).toBe(false);
      expect(body.verificacao.detalhe).toContain("REDUNDANT");
    });

    it("rejects a blank motivo before touching Omie", async () => {
      const result = await run({ codigo_lancamento_omie: 5962280604, motivo: "  " });

      expect(result.isError).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("audits every Omie call it makes, each under the tool's name", async () => {
      const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        respond(OPEN_TITLE, {}, CANCEL_OK, { conta_receber_cadastro: [] });
        await run({ codigo_lancamento_omie: 5962280604, motivo: "x" });

        const entries = stderr.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("AUDIT "))
          .map((l) => JSON.parse(l.slice(6)));
        expect(entries.map((e) => e.call)).toEqual([
          "ConsultarContaReceber", "AlterarContaReceber", "CancelarContaReceber", "ListarContasReceber",
        ]);
        expect(entries.every((e) => e.tool === "cancel_account_receivable" && e.outcome === "ok")).toBe(true);
      } finally {
        stderr.mockRestore();
      }
    });
  });

  /**
   * list_unreconciled_entries joins two reads. The rows below are trimmed from
   * the production Sicredi account on 2026-09-27 (names and tax IDs replaced):
   * the extrato's nCodLancamento is the settlement's nCodMovCC.
   */
  describe("list_unreconciled_entries", () => {
    const CC = 5952605177;
    const saldo = (n: number, d: string) => ({ cDesCliente: "SALDO", dDataLancamento: d, nCodLancamento: n, nSaldo: 0, nValorDocumento: 0 });
    const RECEIPT_ROW = {
      nCodLancamento: 5964359132, dDataLancamento: "09/09/2026", nValorDocumento: 6000, cNatureza: "R",
      cOrigem: "Conta Recebida", cSituacao: "Não conciliado", cDesCliente: "CLIENTE A", cRazCliente: "CLIENTE A LTDA",
      cTipoDocumento: "Nota Fiscal Eletrônica", cDocumentoFiscal: "00003996", nCodLancRelac: 5964359132,
    };
    const PAYMENT_ROW = {
      nCodLancamento: 5964883856, dDataLancamento: "10/09/2026", nValorDocumento: -1100, cNatureza: "P",
      cOrigem: "Conta Paga", cSituacao: "Não conciliado", cDesCliente: "FORNECEDOR B", cRazCliente: "FORNECEDOR B LTDA",
      cTipoDocumento: "Boleto", cNumero: "RPS 3941162",
    };
    const FORECAST_ROW = {
      nCodLancamento: 5965615250, dDataLancamento: "15/09/2026", nValorDocumento: 4250, cNatureza: "R",
      cOrigem: "Conta a Receber", cSituacao: "Previsto", cDesCliente: "CLIENTE C",
    };
    const RECONCILED_ROW = { ...RECEIPT_ROW, nCodLancamento: 5960000001, cSituacao: "Conciliado", dDataConciliacao: "05/09/2026" };
    const extrato = (rows: unknown[]) => ({
      nCodCC: CC, cDescricao: "Sicredi", nCodBanco: "748", nCodAgencia: "0737", nNumConta: "35652-8",
      dPeriodoInicial: "01/09/2026", dPeriodoFinal: "27/09/2026", nSaldoAtual: 29220.04, nSaldoConciliado: -1100,
      listaMovimentos: [{ ...saldo(1, "31/08/2026"), cDesCliente: "SALDO ANTERIOR" }, saldo(2, "01/09/2026"), ...rows],
    });
    const settlement = (d: Record<string, unknown>) => ({ detalhes: { nCodCC: CC, ...d }, resumo: {} });
    const RECEIPT_BX = settlement({ cNatureza: "R", cGrupo: "CONTA_CORRENTE_REC", nCodBaixa: 5964359133, nCodMovCC: 5964359132, nCodTitulo: 5964354918 });
    const PAYMENT_BX = settlement({ cNatureza: "P", cGrupo: "CONTA_CORRENTE_PAG", nCodBaixa: 5964883857, nCodMovCC: 5964883856, nCodTitulo: 1622803363 });

    function respond(...bodies: unknown[]) {
      for (const b of bodies) mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(b) });
    }
    const sent = () => mockFetch.mock.calls.map(([url, opts]) => {
      const body = JSON.parse(opts.body);
      return { url, call: body.call, param: body.param[0] };
    });
    const PERIOD = { dPeriodoInicial: "01/09/2026", dPeriodoFinal: "27/09/2026" };
    const run = async (args: Record<string, unknown>) => {
      const result = await callToolHandler({ params: { name: "list_unreconciled_entries", arguments: args } });
      return { result, body: result.isError ? undefined : JSON.parse(result.content[0].text) };
    };

    it("lists the unreconciled rows, each with its settlement and whether the API can reconcile it", async () => {
      respond(
        extrato([RECEIPT_ROW, PAYMENT_ROW, FORECAST_ROW, RECONCILED_ROW, saldo(3, "10/09/2026")]),
        { nPagina: 1, nTotPaginas: 1, movimentos: [RECEIPT_BX, PAYMENT_BX] },
      );

      const { result, body } = await run({ nCodCC: CC, ...PERIOD });

      expect(result.isError).toBeUndefined();
      expect(sent()).toEqual([
        { url: "https://app.omie.com.br/api/v1/financas/extrato/", call: "ListarExtrato", param: { nCodCC: CC, ...PERIOD } },
        {
          url: "https://app.omie.com.br/api/v1/financas/mf/", call: "ListarMovimentos",
          param: { nPagina: 1, nRegPorPagina: 100, cTpLancamento: "BX", nCodCC: CC, dDtPagtoDe: "01/09/2026", dDtPagtoAte: "27/09/2026" },
        },
      ]);
      expect(body.pendentes.map((p: any) => p.nCodLancamento)).toEqual([5964359132, 5964883856]);
      expect(body.pendentes[0]).toMatchObject({
        tipo: "recebimento", nCodBaixa: 5964359133, nCodTitulo: 5964354918, conciliavel_via_api: true,
        cRazCliente: "CLIENTE A LTDA", nValorDocumento: 6000,
      });
      expect(body.pendentes[0].como_conciliar).toContain("reconcile_receipt with codigo_baixa 5964359133");
      expect(body.pendentes[1]).toMatchObject({ tipo: "pagamento", nCodBaixa: 5964883857, conciliavel_via_api: false });
      expect(body.pendentes[1].como_conciliar).toContain("no ConciliarPagamento");
      // The daily SALDO rows are not entries; the forecast and the reconciled row are counted, not listed.
      expect(body.resumo).toEqual({
        lancamentos_no_periodo: 4,
        por_situacao: { "Não conciliado": 2, Previsto: 1, Conciliado: 1 },
        pendentes: 2,
        conciliaveis_via_api: 1,
        entradas_pendentes: 6000,
        saidas_pendentes: -1100,
      });
      expect(body.conta).toMatchObject({ nCodCC: CC, cDescricao: "Sicredi" });
      expect(body.saldos).toEqual({ nSaldoAtual: 29220.04, nSaldoConciliado: -1100 });
      expect(body.read_at).toMatch(/^\d{4}-/);
    });

    it("does not read the settlements when nothing is pending", async () => {
      respond(extrato([FORECAST_ROW, RECONCILED_ROW]));

      const { body } = await run({ nCodCC: CC, ...PERIOD });

      expect(sent().map((s) => s.call)).toEqual(["ListarExtrato"]);
      expect(body.pendentes).toEqual([]);
      expect(body.resumo.pendentes).toBe(0);
    });

    it("pages through the settlements until it finds every one", async () => {
      respond(
        extrato([RECEIPT_ROW, PAYMENT_ROW]),
        { nPagina: 1, nTotPaginas: 2, movimentos: [PAYMENT_BX] },
        { nPagina: 2, nTotPaginas: 2, movimentos: [RECEIPT_BX] },
      );

      const { body } = await run({ nCodCC: CC, ...PERIOD });

      expect(sent().map((s) => s.param.nPagina)).toEqual([undefined, 1, 2]);
      expect(body.pendentes[0]).toMatchObject({ nCodBaixa: 5964359133, conciliavel_via_api: true });
    });

    it("never pairs a row with a settlement from another account", async () => {
      const elsewhere = settlement({ ...RECEIPT_BX.detalhes, nCodCC: 5965615212 });
      respond(extrato([RECEIPT_ROW]), { nPagina: 1, nTotPaginas: 1, movimentos: [elsewhere] });

      const { body } = await run({ nCodCC: CC, ...PERIOD });

      expect(body.pendentes[0]).not.toHaveProperty("nCodBaixa");
      expect(body.pendentes[0].conciliavel_via_api).toBe(false);
      // A receipt whose settlement was not found says where to look for it.
      expect(body.pendentes[0].como_conciliar).toContain("nCodMovCC 5964359132");
    });

    it("tells a manual ledger entry apart from a settlement", async () => {
      const manual = { ...PAYMENT_ROW, nCodLancamento: 5971370949, cOrigem: "Lançamento no Conta Corrente", nValorDocumento: -215.74 };
      respond(extrato([manual]), { nPagina: 1, nTotPaginas: 1, movimentos: [] });

      const { body } = await run({ nCodCC: CC, ...PERIOD });

      expect(body.pendentes[0]).toMatchObject({ tipo: "lancamento_cc", conciliavel_via_api: false });
    });

    it("resolves an account given by integration code to its nCodCC for the settlements", async () => {
      respond(extrato([RECEIPT_ROW]), { nPagina: 1, nTotPaginas: 1, movimentos: [RECEIPT_BX] });

      await run({ cCodIntCC: "SICREDI", ...PERIOD });

      expect(sent()[0].param).toEqual({ cCodIntCC: "SICREDI", ...PERIOD });
      expect(sent()[1].param).toMatchObject({ nCodCC: CC });
    });

    it("needs an account before it asks Omie anything", async () => {
      const { result } = await run(PERIOD);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("at least one of: nCodCC, cCodIntCC");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
