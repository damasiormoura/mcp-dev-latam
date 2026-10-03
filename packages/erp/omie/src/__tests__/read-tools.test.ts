import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The 50 read tools, property by property.
 *
 * Every property of the 47 read tools production ran (0.8.2) was exercised
 * against the ERP on 2026-09-27 (READ-TOOLS-LIVE.md has the matrix);
 * get_cash_entry and list_unreconciled_entries came with 0.9.0, and
 * get_service_order_status with 0.9.2, and are pinned here from the schema
 * alone until they are validated live. This file pins the
 * half of that which does not need Omie: that each property reaches the
 * `param` Omie receives under its own name and with the value given, that the
 * defaults the param builders inject are exactly the ones intended — and, from
 * the fixtures in ./fixtures/live (real responses, anonymized), that the
 * behaviours found live stay fixed.
 */

let callToolHandler: Function;

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
  class FakeServer {
    setRequestHandler(schema: any, handler: Function) {
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
  mockFetch.mockReset();
  global.fetch = mockFetch as any;
  await import("../index.js");
});

async function send(name: string, args: Record<string, unknown>, response: unknown = {}) {
  mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(response) });
  const result = await callToolHandler({ params: { name, arguments: args } });
  const [url, opts] = mockFetch.mock.calls.at(-1) ?? [];
  const body = opts ? JSON.parse(opts.body) : undefined;
  return { result, url, body, sent: body?.param?.[0] };
}

const tools = async () => (await import("../tools/index.js")).TOOLS;

/**
 * Minimal call and the exact param it must produce — the defaults each param
 * builder injects, and nothing else. A tool absent here would fail the
 * "covers every read tool" test below.
 */
const PAGE_SNAKE = { pagina: 1, registros_por_pagina: 50 };
const PAGE_N = { nPagina: 1, nRegPorPagina: 50 };
const READ: Record<string, { args: Record<string, unknown>; sends: Record<string, unknown> }> = {
  // Customers
  list_customers: { args: {}, sends: PAGE_SNAKE },
  get_customer: { args: { codigo_cliente_omie: 7 }, sends: { codigo_cliente_omie: 7 } },
  list_customers_summary: { args: {}, sends: PAGE_SNAKE },
  // Products
  list_products: { args: {}, sends: { ...PAGE_SNAKE, filtrar_apenas_omiepdv: "N" } },
  get_product: { args: { codigo: "SKU-1" }, sends: { codigo: "SKU-1" } },
  // Sales orders & invoices
  list_orders: { args: {}, sends: PAGE_SNAKE },
  get_sales_order: { args: { codigo_pedido: 7 }, sends: { codigo_pedido: 7 } },
  get_order_status: { args: { codigo_pedido_integracao: "PED-7" }, sends: { codigo_pedido_integracao: "PED-7" } },
  simulate_order_taxes: {
    args: { codigo_cliente: 1, det_simul: [{ produto_simul: { codigo_produto: 2, quantidade: 1, valor_unitario: 10 } }] },
    sends: { codigo_cliente: 1, det_simul: [{ produto_simul: { codigo_produto: 2, quantidade: 1, valor_unitario: 10 } }] },
  },
  validate_order: { args: { cCodIntPed: "PED-7" }, sends: { cCodIntPed: "PED-7" } },
  list_order_stages: { args: {}, sends: PAGE_N },
  list_invoices: { args: {}, sends: PAGE_SNAKE },
  create_invoice: { args: { nCodNF: 7 }, sends: { nCodNF: 7 } },
  get_invoice_pdf: { args: { nIdNfe: 7 }, sends: { nIdNfe: 7 } },
  // Purchasing
  list_purchase_orders: { args: {}, sends: { nPagina: 1, nRegsPorPagina: 50 } },
  get_purchase_order: { args: { cNumero: "7" }, sends: { cNumero: "7" } },
  // Services
  list_service_orders: { args: {}, sends: PAGE_SNAKE },
  get_service_order: { args: { cNumOS: "20" }, sends: { cNumOS: "20" } },
  get_service_order_status: { args: { nCodOS: 7 }, sends: { nCodOS: 7 } },
  validate_service_order: { args: { nCodOS: 7 }, sends: { nCodOS: 7 } },
  list_services: { args: {}, sends: PAGE_N },
  list_nfse: { args: {}, sends: PAGE_N },
  // Finance
  get_financial: { args: {}, sends: PAGE_SNAKE },
  get_account_receivable: { args: { codigo_lancamento_omie: 7 }, sends: { codigo_lancamento_omie: 7 } },
  list_accounts_payable: { args: {}, sends: PAGE_SNAKE },
  get_account_payable: { args: { codigo_lancamento_integracao: "AP-7" }, sends: { codigo_lancamento_integracao: "AP-7" } },
  list_cash_entries: { args: {}, sends: PAGE_N },
  get_cash_entry: { args: { nCodLanc: 7 }, sends: { nCodLanc: 7 } },
  list_financial_movements: { args: {}, sends: PAGE_N },
  get_bank_statement: {
    args: { nCodCC: 3, dPeriodoInicial: "01/09/2026", dPeriodoFinal: "30/09/2026" },
    sends: { nCodCC: 3, dPeriodoInicial: "01/09/2026", dPeriodoFinal: "30/09/2026" },
  },
  get_finance_summary: { args: {}, sends: { lApenasResumo: true } },
  // Multi-step (run): the first of its two reads. The join is in index.test.ts.
  list_unreconciled_entries: {
    args: { nCodCC: 3, dPeriodoInicial: "01/09/2026", dPeriodoFinal: "30/09/2026" },
    sends: { nCodCC: 3, dPeriodoInicial: "01/09/2026", dPeriodoFinal: "30/09/2026" },
  },
  list_open_titles: { args: { cTipo: "R" }, sends: { cTipo: "R", ...PAGE_N } },
  // Billing
  get_pix_qrcode: { args: {}, sends: {} },
  get_pix_status: { args: { nCodTitulo: 7 }, sends: { nCodTitulo: 7 } },
  list_pix: { args: {}, sends: PAGE_N },
  get_boleto: { args: { cCodIntTitulo: "AR-7" }, sends: { cCodIntTitulo: "AR-7" } },
  // Stock
  list_stock_adjustments: { args: {}, sends: PAGE_SNAKE },
  get_stock_position: { args: {}, sends: PAGE_N },
  get_product_stock: { args: { cod_int: "P-7" }, sends: { cod_int: "P-7" } },
  list_stock_movements: { args: {}, sends: PAGE_N },
  list_stock_locations: { args: {}, sends: PAGE_N },
  // Registries
  get_company_info: { args: {}, sends: PAGE_SNAKE },
  get_bank_accounts: { args: {}, sends: PAGE_SNAKE },
  list_categories: { args: {}, sends: PAGE_SNAKE },
  list_departments: { args: {}, sends: PAGE_SNAKE },
  list_projects: { args: {}, sends: PAGE_SNAKE },
  list_dre: { args: {}, sends: { apenasContasAtivas: "S" } },
  list_payment_terms: { args: {}, sends: PAGE_SNAKE },
  list_salespeople: { args: {}, sends: PAGE_SNAKE },
};

/**
 * One value per declared property, derived from the schema so a property added
 * later is exercised without editing this file. Values are distinct per
 * property (a counter), so two fields swapped by a param builder would show.
 */
function sampleArgs(schema: any): Record<string, unknown> {
  let n = 0;
  const value = (prop: any, name: string): unknown => {
    n++;
    if (Array.isArray(prop.enum)) return prop.enum[0];
    switch (prop.type) {
      case "string":
        return /DD\/MM\/YYYY/.test(prop.description ?? "") ? `${String(n % 28 + 1).padStart(2, "0")}/02/2027` : `${name}-${n}`;
      case "number":
        return typeof prop.maximum === "number" ? Math.min(prop.maximum, 10 + n) : 1000 + n;
      case "boolean":
        return true;
      case "array":
        return prop.items ? [value(prop.items, name)] : [];
      case "object":
        return prop.properties ? object(prop) : { cnpj_cpf: `${name}-${n}` };
      default:
        throw new Error(`no sample for ${name}`);
    }
  };
  const object = (s: any) =>
    Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, p]) => [k, value(p, k)]));
  return object(schema);
}

/**
 * Where a builder deliberately rewrites a value the full call supplies. Every
 * other property must reach Omie exactly as given.
 */
const FULL_REWRITES: Record<string, Record<string, unknown>> = {
  // Both summary flags "S": the tool asks for the full NF and strips det itself.
  list_invoices: { cApenasResumo: "N" },
  // Given both account keys, it asks ListarExtrato by nCodCC alone.
  list_unreconciled_entries: { cCodIntCC: undefined },
};

/** A response the tool can finish on, for the multi-step one that reads what Omie answered. */
const FULL_RESPONSES: Record<string, (args: Record<string, unknown>) => unknown> = {
  list_unreconciled_entries: (args) => ({ nCodCC: args.nCodCC, listaMovimentos: [] }),
};

describe("read tools — what reaches Omie", () => {
  it("covers every read tool, and only read tools", async () => {
    const { isRead } = await import("../tools/index.js");
    const reads = (await tools()).filter(isRead).map((t) => t.name).sort();

    expect(reads).toHaveLength(50);
    expect(Object.keys(READ).sort()).toEqual(reads);
  });

  describe("minimal call → the builder's defaults, and nothing else", () => {
    it.each(Object.entries(READ))("%s", async (name, { args, sends }) => {
      const tool = (await tools()).find((t) => t.name === name)!;
      const { url, body, sent } = await send(name, args);

      expect(url).toBe(`https://app.omie.com.br/api/v1${tool.path}`);
      expect(body.call).toBe(tool.call);
      expect(sent).toEqual(sends);
    });
  });

  describe("every declared property reaches the param under its own name and value", () => {
    it.each(Object.keys(READ))("%s", async (name) => {
      const tool = (await tools()).find((t) => t.name === name)!;
      const { validateArgs } = await import("../omie.js");
      const full = sampleArgs(tool.inputSchema);

      expect(validateArgs(tool.inputSchema, full), "sample must pass the tool's own schema").toEqual([]);
      const { result, sent } = await send(name, full, FULL_RESPONSES[name]?.(full));

      expect(result.isError).toBeUndefined();
      expect(sent).toEqual({ ...full, ...FULL_REWRITES[name] });
    });
  });
});

describe("defaults that depend on what else was sent", () => {
  const param = async (name: string, args: Record<string, unknown>) => (await send(name, args)).sent;

  it("list_invoices applies a change window only with a flag, so it sends one", async () => {
    // Production: the window alone returned all 453 NFs; with either flag, 9.
    expect(await param("list_invoices", { filtrar_por_data_de: "20/09/2026" })).toMatchObject({ filtrar_apenas_alteracao: "S" });
    expect(await param("list_invoices", { filtrar_por_data_ate: "27/09/2026" })).toMatchObject({ filtrar_apenas_alteracao: "S" });
    const inclusion = await param("list_invoices", { filtrar_por_data_de: "20/09/2026", filtrar_apenas_inclusao: "S" });
    expect(inclusion).toMatchObject({ filtrar_apenas_inclusao: "S" });
    expect(inclusion).not.toHaveProperty("filtrar_apenas_alteracao");
    expect(await param("list_invoices", { filtrar_por_data_de: "20/09/2026", filtrar_apenas_alteracao: "N" }))
      .toMatchObject({ filtrar_apenas_alteracao: "N" });
    expect(await param("list_invoices", { dEmiInicial: "01/09/2026" })).not.toHaveProperty("filtrar_apenas_alteracao");
  });

  it("list_invoices turns the summary off on the wire only when the order details are asked for too", async () => {
    expect(await param("list_invoices", { cApenasResumo: "S", cDetalhesPedido: "S" })).toMatchObject({ cApenasResumo: "N", cDetalhesPedido: "S" });
    expect(await param("list_invoices", { cApenasResumo: "S", cDetalhesPedido: "N" })).toMatchObject({ cApenasResumo: "S" });
    expect(await param("list_invoices", { cApenasResumo: "N", cDetalhesPedido: "S" })).toMatchObject({ cApenasResumo: "N" });
  });

  it("get_finance_summary keeps an explicit lApenasResumo", async () => {
    expect(await param("get_finance_summary", { lApenasResumo: false })).toEqual({ lApenasResumo: false });
    expect(await param("get_finance_summary", { dDia: "25/09/2026" })).toEqual({ dDia: "25/09/2026", lApenasResumo: true });
  });

  it("list_dre keeps an explicit apenasContasAtivas", async () => {
    expect(await param("list_dre", { apenasContasAtivas: "N" })).toEqual({ apenasContasAtivas: "N" });
  });

  it("list_products keeps an explicit PDV flag and paging", async () => {
    expect(await param("list_products", { filtrar_apenas_omiepdv: "S", pagina: 4, registros_por_pagina: 5 }))
      .toEqual({ filtrar_apenas_omiepdv: "S", pagina: 4, registros_por_pagina: 5 });
  });

  it("list_financial_movements picks the title type from cNatureza only when cStatus is set", async () => {
    expect(await param("list_financial_movements", { cNatureza: "R", cStatus: "ATRASADO" })).toMatchObject({ cTpLancamento: "CR" });
    expect(await param("list_financial_movements", { cNatureza: "P", cStatus: "AVENCER" })).toMatchObject({ cTpLancamento: "CP" });
    expect(await param("list_financial_movements", { cStatus: "AVENCER" })).toMatchObject({ cTpLancamento: "CPCR" });
    expect(await param("list_financial_movements", { cStatus: "RECEBIDO", cTpLancamento: "BXCR" })).toMatchObject({ cTpLancamento: "BXCR" });
    expect(await param("list_financial_movements", { cNatureza: "R" })).not.toHaveProperty("cTpLancamento");
  });

  it("list_purchase_orders keeps an explicit page", async () => {
    expect(await param("list_purchase_orders", { nPagina: 3, nRegsPorPagina: 10 })).toEqual({ nPagina: 3, nRegsPorPagina: 10 });
  });
});

describe("dispatch edges on the read path", () => {
  it("a call with no arguments object is treated as {}", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ departamentos: [] }) });
    const result = await callToolHandler({ params: { name: "list_departments" } });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).param[0]).toEqual(PAGE_SNAKE);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ departamentos: [] });
  });

  it("a response that is not an object is passed through without read_at", async () => {
    for (const body of [[{ nCodCC: 1 }], null]) {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(body) });
      const result = await callToolHandler({ params: { name: "list_departments", arguments: {} } });
      expect(JSON.parse(result.content[0].text)).toEqual(body);
    }
  });

  it("a failure that is not an Error still reaches the agent as text, after the read retries", async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockRejectedValue("socket hang up");
      const plain = callToolHandler({ params: { name: "list_departments", arguments: {} } });
      const multiStep = callToolHandler({ params: { name: "cancel_account_receivable", arguments: { codigo_lancamento_omie: 1, motivo: "x" } } });
      await vi.advanceTimersByTimeAsync(30_000);
      expect((await plain).content[0].text).toBe("Error: socket hang up");
      expect((await multiStep).content[0].text).toBe("Error: socket hang up");
      // Reads are retried twice on a network-shaped failure: 3 attempts each.
      expect(mockFetch).toHaveBeenCalledTimes(6);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("schema constraints found live — refused before reaching Omie", () => {
  const reject = async (name: string, args: Record<string, unknown>) => {
    const result = await callToolHandler({ params: { name, arguments: args } });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    return result.content[0].text as string;
  };

  it("list_customers_summary wants objects in clientesPorCodigo, as Omie does", async () => {
    // Production: [5951279344] → "O preenchimento da tag [codigo_cliente_omie] ou
    // [codigo_cliente_integracao] é obrigatório!"
    expect(await reject("list_customers_summary", { clientesPorCodigo: [5951279344] })).toContain("clientesPorCodigo[0] must be an object");
    expect(await reject("list_customers_summary", { clientesPorCodigo: [{}] }))
      .toContain("clientesPorCodigo[0] must include at least one of: codigo_cliente_omie, codigo_cliente_integracao");
  });

  it("list_customers_summary accepts the object form", async () => {
    const { sent } = await send("list_customers_summary", { clientesPorCodigo: [{ codigo_cliente_integracao: "C-1" }] });
    expect(sent.clientesPorCodigo).toEqual([{ codigo_cliente_integracao: "C-1" }]);
  });

  it("get_bank_statement needs an account, as Omie does", async () => {
    // Production: "O preenchimento das tags [nCodCC] ou [cCodIntCC] é obrigatório!"
    expect(await reject("get_bank_statement", { dPeriodoInicial: "08/09/2026", dPeriodoFinal: "10/09/2026" }))
      .toContain("must include at least one of: nCodCC, cCodIntCC");
    const { sent } = await send("get_bank_statement", { cCodIntCC: "CC-1", dPeriodoInicial: "08/09/2026", dPeriodoFinal: "10/09/2026" });
    expect(sent).toEqual({ cCodIntCC: "CC-1", dPeriodoInicial: "08/09/2026", dPeriodoFinal: "10/09/2026" });
  });
});

type Fixture = { _comment: string; tool: string; args: Record<string, unknown>; response: any };
const FIXTURES = fileURLToPath(new URL("./fixtures/live/", import.meta.url));
const fixtures: [string, Fixture][] = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => [f, JSON.parse(readFileSync(FIXTURES + f, "utf8"))]);

/** Runs a fixture through the server: what was sent, and what the agent got. */
async function replay(fx: Fixture) {
  const { result, sent } = await send(fx.tool, fx.args, fx.response);
  expect(result.isError, result.content?.[0]?.text).toBeUndefined();
  const { read_at, ...out } = JSON.parse(result.content[0].text);
  expect(read_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  return { sent, out };
}

describe("regressions from live behaviour (anonymized production responses)", () => {
  const fx = (name: string) => fixtures.find(([f]) => f === name)![1];

  it("has a fixture for each live finding", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(18);
    for (const [f, body] of fixtures) {
      expect(body._comment, f).toMatch(/Production 2026-09-27/);
      expect(f.startsWith(`${body.tool}.`), f).toBe(true);
    }
  });

  it.each(fixtures)("%s replays cleanly and carries no personal data", async (_f, body) => {
    const text = JSON.stringify(body);
    // Real CNPJs, e-mails and signed-URL credentials must not be in a fixture.
    for (const m of text.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g) ?? []) expect(m).toMatch(/^(\d\d)\.0\1\.0\1\/0001-\1$/);
    for (const m of text.match(/[\w.-]+@[\w-]+\.[\w.]+/g) ?? []) expect(m).toMatch(/@exemplo\.com\.br$/);
    expect(text).not.toMatch(/AKIA[A-Z0-9]{8,}/);
    await replay(body);
  });

  it("list_invoices with summary + order details: det stripped, pedido and titulos kept", async () => {
    const { sent, out } = await replay(fx("list_invoices.resumo-detalhes.json"));
    expect(sent).toMatchObject({ cApenasResumo: "N", cDetalhesPedido: "S" });
    const [nf] = out.nfCadastro;
    expect(nf).not.toHaveProperty("det");
    expect(nf.pedido.cNumPedido).toBe("10");
    expect(nf.titulos[0].nCodTitulo).toBe(5962533719);
    expect(nf.total.ICMSTot.vNF).toBe(3500);
  });

  it("list_invoices with a change window sends the flag that makes Omie apply it", async () => {
    const { sent, out } = await replay(fx("list_invoices.change-window.json"));
    expect(sent).toMatchObject({ filtrar_por_data_de: "20/09/2026", filtrar_por_data_ate: "27/09/2026", filtrar_apenas_alteracao: "S" });
    expect(out.total_de_registros).toBe(9);
    // The summary alone is not rewritten: det stays as Omie sent it (empty).
    expect(out.nfCadastro[0].det).toEqual([]);
  });

  it("list_financial_movements: overdue receivables are the titles only", async () => {
    const { sent, out } = await replay(fx("list_financial_movements.receivables-overdue.json"));
    expect(sent).toMatchObject({ cNatureza: "R", cStatus: "ATRASADO", cTpLancamento: "CR" });
    expect(out.nTotRegistros).toBe(2);
    expect(out.movimentos.every((m: any) => m.detalhes.cGrupo === "CONTA_A_RECEBER")).toBe(true);
  });

  it("list_open_titles: the bank-logo URL is dropped, nDiasAtraso passed through as Omie sends it", async () => {
    const { sent, out } = await replay(fx("list_open_titles.weekend.json"));
    expect(sent).toEqual({ cTipo: "R", nPagina: 1, nRegPorPagina: 50 });
    expect(out.ListaEmEberto[0]).not.toHaveProperty("cUrlLogoBanco");
    expect(out.ListaEmEberto[0]).toMatchObject({ nIdTitulo: 5962783931, dVencimento: "25/09/2026", nDiasAtraso: 0 });
  });

  it("get_finance_summary works with no arguments", async () => {
    const { sent, out } = await replay(fx("get_finance_summary.summary.json"));
    expect(sent).toEqual({ lApenasResumo: true });
    expect(out.contaReceber).toMatchObject({ nTotal: 2, vAtraso: 4250, vTotal: 4902 });
  });

  it("get_finance_summary with the overdue lists: the logo URL is dropped from nested rows too", async () => {
    const { sent, out } = await replay(fx("get_finance_summary.overdue.json"));
    expect(sent).toEqual({ lApenasResumo: false });
    expect(JSON.stringify(out)).not.toContain("cUrlLogoBanco");
    expect(out.contaReceberAtraso[0]).toMatchObject({ nIdTitulo: 5965615250, nDiasAtraso: 10 });
  });

  it("list_products: sends the PDV flag off and decodes the HTML entity in the description", async () => {
    const { sent, out } = await replay(fx("list_products.html-entity.json"));
    expect(sent).toMatchObject({ filtrar_apenas_omiepdv: "N", registros_por_pagina: 1 });
    expect(out.produto_servico_cadastro[0].descricao).toBe('BOBINA ELETROGAS DE 1/2"');
  });

  it("list_customers_summary: rows carry codigo_cliente, as the description now says", async () => {
    const { out } = await replay(fx("list_customers_summary.by-code.json"));
    expect(out.clientes_cadastro_resumido[0]).toHaveProperty("codigo_cliente", 5951279344);
    expect(out.clientes_cadastro_resumido[0]).not.toHaveProperty("codigo_cliente_omie");
  });

  it("list_order_stages: one order, one row per stage it entered", async () => {
    const { out } = await replay(fx("list_order_stages.history.json"));
    expect(out.etapasPedido.map((r: any) => [r.nCodPed, r.cEtapa])).toEqual([[5962530736, "60"], [5962530736, "70"]]);
  });

  it("list_cash_entries: title settlements are in the ledger listing", async () => {
    const { sent, out } = await replay(fx("list_cash_entries.settlement.json"));
    expect(sent).toMatchObject({ cOrigem: "BAXR" });
    expect(out.listaLancamentos[0].diversos).toMatchObject({ cOrigem: "BAXR", nCodLancCR: 5964354918 });
  });

  it("get_boleto: a not-found comes back in-band and is passed through, not turned into an error", async () => {
    const found = await replay(fx("get_boleto.found.json"));
    expect(found.out).toMatchObject({ cCodStatus: "0", cNumBoleto: "600000003" });
    const missing = await replay(fx("get_boleto.not-found.json"));
    expect(missing.out).toMatchObject({ cCodStatus: "103", cLinkBoleto: "" });
  });

  it("get_pix_qrcode: the Omie.CASH refusal is passed through", async () => {
    const { sent, out } = await replay(fx("get_pix_qrcode.not-omie-cash.json"));
    expect(sent).toEqual({ nIdConta: 5952605177 });
    expect(out).toMatchObject({ cCodStatus: "719", cQrCode: "" });
  });

  it("validate_order: the padded integration code is passed through untouched", async () => {
    const { out } = await replay(fx("validate_order.already-billed.json"));
    expect(out.cCodIntPed).toBe(" ".repeat(60));
    expect(out.cCodStatus).toBe("1");
  });

  it("list_payment_terms: 999 is \"informar o número de parcelas\", 000 and 001 are the single-payment terms", async () => {
    const { out } = await replay(fx("list_payment_terms.all.json"));
    const byCode = Object.fromEntries(out.cadastros.map((t: any) => [t.nCodigo, t]));
    expect(out.cadastros).toHaveLength(36);
    expect(byCode["999"]).toMatchObject({ cDescricao: "Informar o número de parcelas", nParcelas: 999 });
    expect(byCode["000"]).toMatchObject({ cDescricao: "A Vista", nParcelas: 1 });
    expect(byCode["001"]).toMatchObject({ cDescricao: "1 Parcela", nParcelas: 1 });
  });

  it("get_invoice_pdf: the XML comes inline", async () => {
    const { out } = await replay(fx("get_invoice_pdf.nfe.json"));
    expect(out.cXmlNfe).toMatch(/^<\?xml/);
    expect(out.cPdf).toMatch(/^https:/);
  });

  it("list_stock_movements and get_bank_statement pass through as Omie sent them", async () => {
    const moves = await replay(fx("list_stock_movements.truncated-window.json"));
    expect(moves.sent).toMatchObject({ dDtInicial: "15/07/2026", dDtFinal: "27/09/2026" });
    expect(moves.out.nTotRegistros).toBe(42);
    const statement = await replay(fx("get_bank_statement.period.json"));
    expect(statement.out.listaMovimentos[1]).toMatchObject({ cSituacao: "Não conciliado", nValorDocumento: 6000 });
  });
});

/**
 * get_service_order_status (0.9.2) has not been called live yet, so these
 * responses are not captured ones: they are shaped from osStatusResponse as
 * Omie publishes it and from what StatusOS returned by hand on 2026-10-02 for
 * the rejected RPS 17 (OS 38). The city hall's own wording is not reproduced —
 * only the codes. Replace them with an anonymized fixture in ./fixtures/live
 * once the live validation in READ-TOOLS-LIVE.md is done.
 */
describe("get_service_order_status: what the agent gets back", () => {
  const sendAttempt = (lote: number, hora: string) => [
    { cCodigo: "", cDescricao: `Enviando o RPS 17 no Lote ${lote} para a prefeitura da sua cidade.`, cCorrecao: "", cSituacao: "", dData: "02/10/2026", hHora: hora },
    { cCodigo: "", cDescricao: "Envio do RPS 17 retornou erros.", cCorrecao: "", cSituacao: "", dData: "02/10/2026", hHora: hora },
    { cCodigo: "EM076", cDescricao: "mensagem EM076 da prefeitura", cCorrecao: "correção EM076", cSituacao: "ERRO", dData: "02/10/2026", hHora: hora },
    { cCodigo: "E0314", cDescricao: "mensagem E0314 da prefeitura", cCorrecao: "correção E0314", cSituacao: "ERRO", dData: "02/10/2026", hHora: hora },
    { cCodigo: "EM062", cDescricao: "mensagem EM062 da prefeitura", cCorrecao: "correção EM062", cSituacao: "ERRO", dData: "02/10/2026", hHora: hora },
  ];
  const os = (rps: Record<string, unknown>) => ({
    cCodIntOS: "", nCodOS: 5975011809, cNumOS: "38", cEtapa: "60", cCancelada: "N", cFaturada: "S", cAmbiente: "P",
    dDtFat: "02/10/2026", nValorTot: 350, cUrlPdfRecibo: "",
    ListaRpsNfse: [{
      nLote: 2, cStatusLote: "003", cProtocolo: "", nRps: "17", cStatusRps: "003", nNfse: "", cCodVerif: "",
      cCNPJ: "11011011000111", cInscrMunicipal: 1, danfe: "", cUrlNfse: "", cUrlPdfDemo: "", cUrlPdfDest: "", cUrlRps: "",
      ...rps,
    }],
  });

  it("a rejected RPS: status 003 and every attempt's messages, newest first, as Omie sent them", async () => {
    const mensagens = [...sendAttempt(3, "11:40:00"), ...sendAttempt(2, "10:05:00")];
    const { sent, result } = await send("get_service_order_status", { nCodOS: 5975011809, lMsg: true }, os({ mensagens, xml_distr: "" }));

    expect(sent).toEqual({ nCodOS: 5975011809, lMsg: true });
    const [rps] = JSON.parse(result.content[0].text).ListaRpsNfse;
    expect(rps).toMatchObject({ nRps: "17", cStatusRps: "003", cStatusLote: "003" });
    expect(rps.mensagens).toEqual(mensagens);
    expect(rps.mensagens.filter((m: any) => m.cSituacao === "ERRO").map((m: any) => m.cCodigo))
      .toEqual(["EM076", "E0314", "EM062", "EM076", "E0314", "EM062"]);
    expect(rps).not.toHaveProperty("xml_distr");
  });

  it("an issued NFS-e: status 004 and the note number kept, the inline XML left out", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><CompNfse>${"<x/>".repeat(5000)}</CompNfse>`;
    const { result } = await send(
      "get_service_order_status",
      { nCodOS: 5973717027 },
      { ...os({ nRps: "15", cStatusLote: "004", cStatusRps: "004", nNfse: "1071", cCodVerif: "ABC123", mensagens: [], xml_distr: xml }), nCodOS: 5973717027, cNumOS: "36" },
    );
    const text = result.content[0].text;

    expect(text).not.toContain("CompNfse");
    const out = JSON.parse(text);
    expect(out).toMatchObject({ nCodOS: 5973717027, cNumOS: "36", cFaturada: "S" });
    expect(out.ListaRpsNfse[0]).toMatchObject({ nRps: "15", cStatusRps: "004", nNfse: "1071", cCodVerif: "ABC123" });
    expect(out.ListaRpsNfse[0]).not.toHaveProperty("xml_distr");
  });

  it("an OS with no RPS is passed through untouched", async () => {
    const body = { nCodOS: 5963175100, cNumOS: "20", cEtapa: "20", cFaturada: "N" };
    const { result } = await send("get_service_order_status", { nCodOS: 5963175100 }, body);
    const { read_at, ...out } = JSON.parse(result.content[0].text);

    expect(out).toEqual(body);
  });
});

/**
 * The descriptions are the fix for the behaviours the server cannot change —
 * Omie ignoring a filter, truncating a window, answering in-band. These pin
 * that each one still says what production showed.
 */
describe("descriptions say what production showed", () => {
  const find = async (name: string) => (await tools()).find((t) => t.name === name)!;
  const text = async (name: string) => JSON.stringify([(await find(name)).description, (await find(name)).inputSchema]);

  it.each([
    ["list_order_stages", /stage history/, /ListarEtapasFaturamento/],
    ["list_cash_entries", /BAXR/, /BAXP/],
    ["list_customers", /ignores every other key/, /estado, cidade, email/],
    ["list_customers_summary", /codigo_cliente,/, /\[5960133379\] is refused/],
    ["list_products", /At least 3 characters/, /DESCRICAO\\" was ignored/],
    ["list_services", /intListar\.nCodServ/, /cOrdenarPor and cOrdemDecrescente changed nothing/],
    ["list_invoices", /"1\\" and \\"001\\" are different series/, /titulos/],
    ["create_invoice", /only narrow an nNF \+ serie lookup/, /nIdPedido/],
    ["get_invoice_pdf", /XML inline/, /cPdf/],
    ["simulate_order_taxes", /O Cenário de impostos precisa ser preenchido/, /codigo_cenario_impostos_item/],
    ["get_bank_statement", /reconciled or not/, /refuses the call without one/],
    ["get_finance_summary", /only then does lExibirCategoria/, /dDia \(default today\) only moves where the cash flow starts/],
    ["get_stock_position", /never moved/, /ignores nRegPorPagina/],
    ["list_stock_movements", /about 60 days/, /not both/],
    ["get_boleto", /cCodStatus \\"103\\"/, /Boleto gerado com sucesso/],
    ["get_pix_qrcode", /Omie\.CASH/, /719/],
    ["list_payment_terms", /ignored by Omie here/, /informar o número de parcelas/],
    ["list_salespeople", /codVend/, /nCodVend/],
    ["list_orders", /total_pedido/, /00 and 70 also occur/],
    ["get_financial", /"A VENCER\\", with a space/, /list_open_titles/],
    ["list_accounts_payable", /paid and later cancelled/, /no due-date filter/],
    ["get_service_order_status", /the only read that says why an RPS was rejected/, /does not resend the RPS — that is ReenviarOS/],
    ["list_nfse", /cStatusNFSe \\"R\\"/, /get_service_order_status/],
    ["get_service_order", /get_service_order_status/, /nothing about the NFS-e/],
    ["invoice_service_order", /does not\s+mean the NFS-e was issued/, /get_service_order_status/],
  ] as const)("%s", async (name, a, b) => {
    const t = await text(name);
    expect(t).toMatch(a);
    expect(t).toMatch(b);
  });

  it("list_financial_movements no longer claims a 30-day default window", async () => {
    expect(await text("list_financial_movements")).not.toMatch(/30 days/);
    expect(await text("list_financial_movements")).toMatch(/state no default date window/);
  });

  it("change_order_stage no longer sends the agent to list_order_stages for the stage set", async () => {
    expect(await text("change_order_stage")).not.toMatch(/list_order_stages/);
  });

  it("filtrar_apenas_alteracao is described as the plain window", async () => {
    const props = ((await find("list_products")).inputSchema as any).properties;
    expect(props.filtrar_apenas_alteracao.description).toMatch(/new record counts as changed/);
    expect(props.filtrar_apenas_inclusao.description).toMatch(/created in the window/);
  });
});

describe("demo responses of read tools use the keys Omie really returns", () => {
  beforeEach(async () => {
    process.env.MCP_DEMO = "true";
    vi.resetModules();
    await import("../index.js");
  });
  afterEach(() => {
    delete process.env.MCP_DEMO;
  });

  const demo = async (name: string) => {
    const result = await callToolHandler({ params: { name, arguments: READ[name].args } });
    return JSON.parse(result.content[0].text);
  };

  it("list_payment_terms: cadastros, and 999 is not \"A vista\"", async () => {
    const body = await demo("list_payment_terms");
    const term999 = body.cadastros.find((t: any) => t.nCodigo === "999");
    expect(term999).toMatchObject({ nParcelas: 999 });
    // Checked on the record itself: a regex over the whole body also sees read_at, whose milliseconds can be 999.
    expect(term999.cDescricao).not.toMatch(/vista/i);
  });

  it("list_customers, get_financial, get_bank_accounts, list_stock_locations: the real ID and list keys", async () => {
    expect((await demo("list_customers")).clientes_cadastro[0]).toHaveProperty("codigo_cliente_omie");
    expect((await demo("get_financial")).conta_receber_cadastro[0]).toHaveProperty("codigo_lancamento_omie");
    expect((await demo("get_bank_accounts")).ListarContasCorrentes[0]).toMatchObject({ nCodCC: 4001, descricao: expect.any(String) });
    expect((await demo("list_stock_locations")).locaisEncontrados[0]).toHaveProperty("codigo_local_estoque");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
