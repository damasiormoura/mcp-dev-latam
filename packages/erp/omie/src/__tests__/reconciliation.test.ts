import { describe, it, expect, vi } from "vitest";
import { reconciliationTools } from "../tools/reconciliation.js";
import type { RunContext } from "../tools/types.js";

/**
 * The edges of list_unreconciled_entries' join, driven through `run` with a
 * scripted context — no dispatch, no Omie. The join itself, the paging and the
 * account checks are in index.test.ts, end to end; these are the sparser
 * shapes Omie can hand back (a period with no rows array, a row with no
 * situação, a settlements page with no movimentos, ...) and the page cap.
 */
const tool = reconciliationTools.find((t) => t.name === "list_unreconciled_entries")!;
const CC = 5;
const PERIOD = { dPeriodoInicial: "01/09/2026", dPeriodoFinal: "27/09/2026" };

function ctx(...responses: unknown[]) {
  const calls: { call: string; param: Record<string, unknown> }[] = [];
  const request = vi.fn(async (_path: string, call: string, param: Record<string, unknown>) => {
    calls.push({ call, param });
    return responses.shift();
  });
  const context: RunContext = { request, attribution: undefined, now: new Date("2026-09-27T12:00:00Z") };
  return { context, calls };
}

const run = (c: RunContext) => tool.run!({ nCodCC: CC, ...PERIOD }, c) as Promise<any>;
const unreconciled = (row: Record<string, unknown>) => ({ nCodLancamento: 1, cSituacao: "Não conciliado", ...row });

describe("list_unreconciled_entries — edges of the join", () => {
  it("reads an extrato with no rows array as an empty period, dated from the arguments", async () => {
    const { context, calls } = ctx({ nCodCC: CC });
    const out = await run(context);

    expect(calls.map((c) => c.call)).toEqual(["ListarExtrato"]);
    expect(out.periodo).toEqual({ de: "01/09/2026", ate: "27/09/2026" });
    expect(out.resumo).toMatchObject({ lancamentos_no_periodo: 0, pendentes: 0, entradas_pendentes: 0, saidas_pendentes: 0 });
    expect(out).not.toHaveProperty("aviso");
  });

  it("counts a row with no situação under its own label — not as a balance row, and not as pending", async () => {
    const { context, calls } = ctx({ nCodCC: CC, listaMovimentos: [{ nCodLancamento: 1, nValorDocumento: 10 }] });
    const out = await run(context);

    expect(out.resumo.por_situacao).toEqual({ "(sem situação)": 1 });
    expect(out.pendentes).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("copes with a settlements page with neither movimentos nor a page count, and a movimento with no detalhes", async () => {
    const payment = unreconciled({ cNatureza: "P", cOrigem: "Conta Paga", cDesCliente: "FORNECEDOR", nValorDocumento: -30 });
    for (const page of [{}, undefined, { nTotPaginas: 1, movimentos: [{}, null] }]) {
      const { context, calls } = ctx({ nCodCC: CC, listaMovimentos: [payment] }, page);
      const out = await run(context);

      expect(calls.map((c) => c.call)).toEqual(["ListarExtrato", "ListarMovimentos"]);
      // No settlement found: still named a payment by its origin, and not reconcilable here.
      expect(out.pendentes[0]).toMatchObject({ tipo: "pagamento", conciliavel_via_api: false, cRazCliente: "FORNECEDOR" });
      expect(out.pendentes[0]).not.toHaveProperty("nCodBaixa");
      expect(out.resumo).toMatchObject({ pendentes: 1, entradas_pendentes: 0, saidas_pendentes: -30 });
    }
  });

  it("stops after 10 pages of settlements and says the list may be incomplete", async () => {
    const page = { nTotPaginas: 12, movimentos: [] };
    const { context, calls } = ctx(
      { nCodCC: CC, listaMovimentos: [unreconciled({ cNatureza: "R", cOrigem: "Conta Recebida", nValorDocumento: 5 })] },
      ...Array(12).fill(page),
    );
    const out = await run(context);

    expect(calls.filter((c) => c.call === "ListarMovimentos").map((c) => c.param.nPagina)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(out.aviso).toMatch(/More than 1000 settlements in the period/);
  });
});
