import { describe, it, expect, vi } from "vitest";
import { updateServiceTool } from "../tools/service-catalogue.js";
import { ToolRefusal, type RunContext } from "../tools/types.js";

/**
 * The edges of update_service, driven through `run` with a scripted context —
 * no dispatch, no Omie. The happy path, the no-op and the audit trail are in
 * index.test.ts, end to end; these are the record shapes and verification
 * outcomes those do not reach.
 */
function ctx(...responses: unknown[]) {
  const calls: { call: string; param: Record<string, unknown> }[] = [];
  const request = vi.fn(async (_path: string, call: string, param: Record<string, unknown>) => {
    calls.push({ call, param });
    const next = responses.shift();
    if (next instanceof Error || typeof next === "string") throw next;
    return next;
  });
  const context: RunContext = { request, attribution: undefined, now: new Date("2026-10-05T18:00:00Z") };
  return { context, calls };
}

const run = (args: Record<string, unknown>, c: RunContext) => updateServiceTool.run!(args, c) as Promise<any>;

const SERVICE = {
  intListar: { nCodServ: 7 },
  cabecalho: { cCodigo: "SRV00001", cCodServMun: "170901/7120100", cTipoDesc: "P" },
  descricao: { cDescrCompleta: "ASSISTÊNCIA TÉCNICA" },
  impostos: { cIndOper: "050101" },
};
const KEY = { intEditar: { nCodServ: 7 } };

describe("update_service — edges", () => {
  it("refuses empty blocks before any call", async () => {
    const { context, calls } = ctx();
    await expect(run({ ...KEY, impostos: {} }, context)).rejects.toBeInstanceOf(ToolRefusal);
    expect(calls).toHaveLength(0);
  });

  it("looks the service up by integration code when that is what it was given", async () => {
    const { context, calls } = ctx({ ...SERVICE, impostos: { cIndOper: "100301" } });
    const out = await run({ intEditar: { cCodIntServ: "SRV-1" }, impostos: { cIndOper: "100301" } }, context);
    expect(calls[0]).toEqual({ call: "ConsultarCadastroServico", param: { cCodIntServ: "SRV-1" } });
    expect(out.alteracoes).toEqual([]);
  });

  it("refuses when Omie returns no service", async () => {
    const { context } = ctx({});
    await expect(run({ ...KEY, impostos: { cIndOper: "100301" } }, context)).rejects.toThrow("Omie returned no service");
  });

  it("refuses a service with products used or a via-única setup, naming both", async () => {
    const { context, calls } = ctx({
      ...SERVICE,
      produtosUtilizados: { produtoUtilizado: [{ nCodProdutoPU: 1 }, { nCodProdutoPU: 2 }] },
      viaUnica: { cUtilizaViaUnica: "S" },
    });
    const err = await run({ ...KEY, impostos: { cIndOper: "100301" } }, context).catch((e) => e);
    expect(err).toBeInstanceOf(ToolRefusal);
    expect(err.message).toContain("SRV00001 (7) has 2 produto(s) utilizado(s) and NF via única");
    expect(calls).toHaveLength(1);
  });

  it("goes ahead when those blocks are present but empty or off", async () => {
    const { context, calls } = ctx(
      { ...SERVICE, produtosUtilizados: { produtoUtilizado: [] }, viaUnica: { cUtilizaViaUnica: "N" } },
      { cCodStatus: "0" },
      { cadastros: [{ ...SERVICE, cabecalho: { ...SERVICE.cabecalho, cCodServMun: "170901/170901" } }] },
    );
    const out = await run({ ...KEY, cabecalho: { cCodServMun: "170901/170901" } }, context);
    // The blocks it does not edit are not sent back.
    expect(Object.keys(calls[1].param).sort()).toEqual(["cabecalho", "descricao", "impostos", "intEditar"]);
    expect(calls[1].param.cabecalho).toEqual({ cCodigo: "SRV00001", cCodServMun: "170901/170901" });
    expect(out.verificacao).toEqual({ confirmado: true });
  });

  it("copes with a record missing blocks: fields it never had are reported as null before", async () => {
    const { context, calls } = ctx({ intListar: { nCodServ: 7 } }, { cCodStatus: "0" }, { cadastros: [null, { intListar: { nCodServ: 7 } }] });
    const out = await run({ ...KEY, descricao: { cDescrCompleta: "NOVA" } }, context);
    expect(calls[1].param).toEqual({ intEditar: { nCodServ: 7 }, cabecalho: {}, descricao: { cDescrCompleta: "NOVA" }, impostos: {} });
    expect(calls[2].param).toEqual({ nPagina: 1, nRegPorPagina: 50, cCodigo: undefined });
    expect(out.alteracoes).toEqual([{ campo: "descricao.cDescrCompleta", antes: null, depois: "NOVA" }]);
    expect(out.verificacao).toEqual({
      confirmado: false,
      divergencias: [{ campo: "descricao.cDescrCompleta", pedido: "NOVA", gravado: null }],
    });
  });

  it("reports a value the listing does not show yet", async () => {
    const { context } = ctx(SERVICE, { cCodStatus: "0" }, { cadastros: [SERVICE] });
    const out = await run({ ...KEY, impostos: { cIndOper: "100301", cClassTrib: "000001" } }, context);
    expect(out.verificacao.divergencias).toEqual([
      { campo: "impostos.cIndOper", pedido: "100301", gravado: "050101" },
      { campo: "impostos.cClassTrib", pedido: "000001", gravado: null },
    ]);
  });

  it("says when the service is not in the confirming listing", async () => {
    const { context } = ctx(SERVICE, { cCodStatus: "0" }, {});
    const out = await run({ ...KEY, impostos: { cIndOper: "100301" } }, context);
    expect(out.verificacao).toMatchObject({ confirmado: false });
    expect(out.verificacao.detalhe).toContain("not in the listing for code SRV00001");
  });

  it("still returns the change when the confirming listing fails", async () => {
    for (const failure of [new Error("HTTP 503"), "socket hang up"]) {
      const { context } = ctx(SERVICE, { cCodStatus: "0" }, failure);
      const out = await run({ ...KEY, impostos: { cIndOper: "100301" } }, context);
      expect(out.resposta_omie).toEqual({ cCodStatus: "0" });
      expect(out.verificacao.detalhe).toMatch(/^verification listing failed: (HTTP 503|socket hang up)$/);
    }
  });
});
