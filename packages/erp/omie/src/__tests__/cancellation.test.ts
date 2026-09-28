import { describe, it, expect, vi } from "vitest";
import { cancellationTools } from "../tools/cancellation.js";
import { ToolRefusal, type RunContext } from "../tools/types.js";

/**
 * The edges of cancel_account_receivable's guard logic, driven through `run`
 * with a scripted context — no dispatch, no Omie. The happy path and the
 * main refusals are in index.test.ts, end to end; these are the shapes Omie
 * can hand back that those do not reach (a title with no boleto block, a
 * boleto known only by its barcode, a listing with no array, ...).
 */
const tool = cancellationTools[0];

function ctx(...responses: unknown[]) {
  const calls: { call: string; param: Record<string, unknown> }[] = [];
  const request = vi.fn(async (_path: string, call: string, param: Record<string, unknown>) => {
    calls.push({ call, param });
    const next = responses.shift();
    if (next instanceof Error || typeof next === "string") throw next;
    return next;
  });
  const context: RunContext = { request, attribution: undefined, now: new Date("2026-09-27T12:00:00Z") };
  return { context, calls };
}

const run = (args: Record<string, unknown>, c: RunContext) => tool.run!(args, c) as Promise<any>;

describe("cancel_account_receivable — edges of the guard", () => {
  it("refuses a missing motivo before any call", async () => {
    const { context, calls } = ctx();
    await expect(run({ codigo_lancamento_omie: 1 }, context)).rejects.toBeInstanceOf(ToolRefusal);
    expect(calls).toHaveLength(0);
  });

  it("looks the title up by integration code when that is what it was given", async () => {
    const { context, calls } = ctx({ codigo_lancamento_omie: 9, status_titulo: "CANCELADO" });
    const out = await run({ codigo_lancamento_integracao: "AR-9", motivo: "x" }, context);
    expect(calls[0]).toEqual({ call: "ConsultarContaReceber", param: { codigo_lancamento_integracao: "AR-9" } });
    expect(out.ja_cancelado).toBe(true);
  });

  it("refuses when Omie returns no title", async () => {
    const { context } = ctx({});
    await expect(run({ codigo_lancamento_omie: 1, motivo: "x" }, context)).rejects.toThrow("Omie returned no title");
  });

  it("refuses a title with no status at all as not open", async () => {
    const { context } = ctx({ codigo_lancamento_omie: 1 });
    await expect(run({ codigo_lancamento_omie: 1, motivo: "x" }, context)).rejects.toThrow('is "undefined", not open');
  });

  it("treats a title with no boleto block and no notes as boleto-free, and writes just the reason", async () => {
    const { context, calls } = ctx(
      { codigo_lancamento_omie: 1, status_titulo: "A VENCER", codigo_cliente_fornecedor: 5 },
      {},
      { codigo_status: "0" },
      {}, // the confirming listing, with no conta_receber_cadastro
    );
    const out = await run({ codigo_lancamento_omie: 1, motivo: "duplicado" }, context);
    expect(calls.map((c) => c.call)).toEqual(["ConsultarContaReceber", "AlterarContaReceber", "CancelarContaReceber", "ListarContasReceber"]);
    expect(calls[1].param).toEqual({ codigo_lancamento_omie: 1, observacao: "Cancelamento solicitado: duplicado." });
    expect(calls[3].param).toMatchObject({ filtrar_por_data_de: "27/09/2026", filtrar_por_data_ate: "27/09/2026" });
    expect(out.verificacao).toMatchObject({ confirmado: false });
  });

  it("names a boleto known only by its barcode, and a sibling sharing that barcode", async () => {
    const title = { codigo_lancamento_omie: 1, status_titulo: "ATRASADO", codigo_cliente_fornecedor: 5, codigo_barras_ficha_compensacao: "123" };
    const { context } = ctx(title, { conta_receber_cadastro: [title, { ...title, codigo_lancamento_omie: 2 }] });
    const err = await run({ codigo_lancamento_omie: 1, motivo: "x" }, context).catch((e) => e);
    expect(err.message).toContain("boleto (no number) (barcode 123)");
    expect(err.message).toContain("SAME boleto: 2");
    expect(err.message).toContain('confirmar_boleto: "S"');
  });

  it("asks for \"S\" when the boleto is flagged generated but has neither number nor barcode", async () => {
    const title = { codigo_lancamento_omie: 1, status_titulo: "VENCEHOJE", codigo_cliente_fornecedor: 5, boleto: { cGerado: "S" } };
    const { context } = ctx(title, {}); // sibling listing with no array
    const err = await run({ codigo_lancamento_omie: 1, motivo: "x" }, context).catch((e) => e);
    expect(err).toBeInstanceOf(ToolRefusal);
    expect(err.message).toContain("No other open title of this customer carries it");
    expect(err.message).toContain('confirmar_boleto: "S"');
  });

  it("reports an unconfirmed cancel whose response has no status", async () => {
    const { context } = ctx({ codigo_lancamento_omie: 1, status_titulo: "EMABERTO" }, {}, undefined);
    await expect(run({ codigo_lancamento_omie: 1, motivo: "x" }, context)).rejects.toThrow("codigo_status undefined");
  });

  it("still returns the cancellation when the confirming listing throws something that is not an Error", async () => {
    const { context } = ctx({ codigo_lancamento_omie: 1, status_titulo: "EMABERTO" }, {}, { codigo_status: "0" }, "socket hang up");
    const out = await run({ codigo_lancamento_omie: 1, motivo: "x" }, context);
    expect(out.verificacao).toEqual({ confirmado: false, detalhe: "verification listing failed: socket hang up" });
  });
});
