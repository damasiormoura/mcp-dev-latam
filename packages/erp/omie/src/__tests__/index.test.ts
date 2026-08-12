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

/** Omie replies are read via res.text() so faults can be unwrapped before parsing. */
const omieOk = (payload: unknown) => ({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) });
const omieFault = (faultstring: string, faultcode: string) => ({
  ok: false,
  status: 500,
  text: () => Promise.resolve(JSON.stringify({ faultstring, faultcode })),
});

describe("mcp-omie", () => {
  it("should register 30 tools", async () => {
    const result = await listToolsHandler();
    expect(result.tools).toHaveLength(30);
  });

  it("should call correct API endpoint for list_customers", async () => {
    mockFetch.mockResolvedValueOnce(omieOk({ clientes_cadastro: [] }));

    await callToolHandler({ params: { name: "list_customers", arguments: {} } });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("app.omie.com.br/api/v1/geral/clientes/");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.call).toBe("ListarClientes");
    expect(body.app_key).toBe("test-key");
  });

  describe("create_service_order", () => {
    it("maps the flat arguments onto Omie's nested osCadastro structure", async () => {
      mockFetch.mockResolvedValueOnce(omieOk({ nCodOS: 99 }));

      await callToolHandler({
        params: {
          name: "create_service_order",
          arguments: {
            codigo_cliente: 5951711950,
            codigo_pedido_integracao: "OS-TOLEDO-1",
            data_previsao: "14/08/2026",
            servicos: [{ descricao: "Limpeza de queimador", quantidade: 1, valor_unitario: 1000 }],
          },
        },
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("/servicos/os/");
      const body = JSON.parse(opts.body);
      expect(body.call).toBe("IncluirOS");

      // The flat snake_case keys must not reach Omie — they are what triggered
      // "Tag [CODIGO_CLIENTE] não faz parte da estrutura do tipo complexo [osCadastro]".
      const [payload] = body.param;
      expect(payload).not.toHaveProperty("codigo_cliente");
      expect(payload).not.toHaveProperty("servicos");
      expect(payload.Cabecalho).toEqual({
        cCodIntOS: "OS-TOLEDO-1",
        nCodCli: 5951711950,
        dDtPrevisao: "14/08/2026",
        cEtapa: "10",
      });
      expect(payload.ServicosPrestados).toEqual([
        { cDescServ: "Limpeza de queimador", nQtde: 1, nValUnit: 1000 },
      ]);
    });

    it("forwards fiscal fields when supplied and omits them otherwise", async () => {
      mockFetch.mockResolvedValueOnce(omieOk({ nCodOS: 99 }));

      await callToolHandler({
        params: {
          name: "create_service_order",
          arguments: {
            codigo_cliente: 1,
            codigo_pedido_integracao: "OS-2",
            data_previsao: "14/08/2026",
            servicos: [
              { descricao: "S", quantidade: 1, valor_unitario: 10, cTribServ: "01", cCodServMun: "1401", cRetemISS: "N" },
            ],
          },
        },
      });

      const [servico] = JSON.parse(mockFetch.mock.calls[0][1].body).param[0].ServicosPrestados;
      expect(servico).toMatchObject({ cTribServ: "01", cCodServMun: "1401", cRetemISS: "N" });
      expect(servico).not.toHaveProperty("cCodServLC116");
    });

    it("lets a native Cabecalho override the mapped fields", async () => {
      mockFetch.mockResolvedValueOnce(omieOk({ nCodOS: 99 }));

      await callToolHandler({
        params: {
          name: "create_service_order",
          arguments: {
            codigo_cliente: 1,
            codigo_pedido_integracao: "OS-3",
            data_previsao: "14/08/2026",
            servicos: [],
            Cabecalho: { cEtapa: "50", nQtdeParc: 3 },
          },
        },
      });

      const { Cabecalho } = JSON.parse(mockFetch.mock.calls[0][1].body).param[0];
      expect(Cabecalho.cEtapa).toBe("50");
      expect(Cabecalho.nQtdeParc).toBe(3);
      expect(Cabecalho.nCodCli).toBe(1);
    });
  });

  describe("Omie fault handling", () => {
    it("surfaces faultstring as a readable message instead of a raw JSON blob", async () => {
      mockFetch.mockResolvedValueOnce(
        omieFault("ERROR: Tag [CODIGO_CLIENTE] não faz parte da estrutura do tipo complexo [osCadastro]!", "SOAP-ENV:Client-5001")
      );

      const result = await callToolHandler({ params: { name: "create_service_order", arguments: {} } });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("SOAP-ENV:Client-5001");
      expect(result.content[0].text).toContain("não faz parte da estrutura");
      expect(result.content[0].text).not.toContain('{"faultstring"');
    });

    it("treats fault 5113 (no rows on this page) as an empty result, not an error", async () => {
      mockFetch.mockResolvedValueOnce(
        omieFault("ERROR: Não existem registros para a página [1]!", "SOAP-ENV:Client-5113")
      );

      const result = await callToolHandler({ params: { name: "list_service_orders", arguments: {} } });

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toMatchObject({ registros: 0, total_de_registros: 0 });
    });
  });
});
