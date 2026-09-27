import { OmieTool, RunContext, ToolRefusal } from "./types.js";

const AR = "/financas/contareceber/";

/**
 * Cancelling an accounts receivable title (CancelarContaReceber).
 *
 * Omie documents this method as "cancelamento do boleto gerado de uma conta a
 * receber" and answers it with "Boleto cancelado com sucesso!" — but verified
 * against production on 2026-09-27 it cancels the *title*: status_titulo goes
 * to CANCELADO, including on a title that never had a boleto. Its sibling
 * CancelarBoleto (cancel_boleto) is a different call on a different endpoint.
 * The two read alike, which is how an agent ended up with no way to cancel a
 * duplicated title and the job was done by hand against the raw API.
 *
 * It is a multi-step tool because the single call is not safe on its own:
 *
 *   1. Read the title. A cancelled one is reported as such without writing; a
 *      settled one is refused, because the settlement has to be undone first
 *      (cancel_receipt) or the money trail no longer adds up.
 *   2. If the title carries a boleto, refuse unless the caller echoes the
 *      boleto number back. Given what Omie's own description says, the call
 *      may request the baixa of that boleto at the bank — and a duplicated
 *      title can carry the *same* boleto as the one that stays open (it did:
 *      two titles sharing nosso número 600000020). Other open titles of the
 *      same customer with that boleto are listed in the refusal.
 *   3. Write the reason, and who asked, into the title's notes. The cancel
 *      call has no notes field, so without this Omie records only
 *      "WEBSERVICE" as the author.
 *   4. Cancel.
 *   5. Confirm through the listing. Right after the write, ConsultarContaReceber
 *      was seen returning the previous state for several seconds, and asking
 *      it again at once trips Omie's REDUNDANT guard; ListarContasReceber
 *      already showed CANCELADO.
 */

/** Statuses a title can be cancelled from, spaces removed (Omie shows "A VENCER"). */
const OPEN = new Set(["AVENCER", "ATRASADO", "VENCEHOJE", "EMABERTO"]);

function normalizeStatus(status: unknown): string {
  return String(status ?? "").toUpperCase().replace(/\s+/g, "");
}

/** The boleto a title carries, if any: the number to echo back, and what identifies it. */
function boletoOf(title: any): { token: string; numero?: string; barras?: string } | undefined {
  const b = title?.boleto ?? {};
  const numero = String(b.cNumBancario || b.cNumBoleto || "").trim() || undefined;
  const barras = String(title?.codigo_barras_ficha_compensacao || "").trim() || undefined;
  if (!numero && !barras && b.cGerado !== "S") return undefined;
  return { token: numero ?? "S", numero, barras };
}

/** DD/MM/YYYY in Omie's timezone, for the change-date filter. */
function omieDate(now: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(now);
}

async function openTitlesSharingBoleto(ctx: RunContext, title: any, boleto: { numero?: string; barras?: string }) {
  const listed = await ctx.request(AR, "ListarContasReceber", {
    pagina: 1,
    registros_por_pagina: 100,
    filtrar_cliente: title.codigo_cliente_fornecedor,
    filtrar_apenas_titulos_em_aberto: "S",
  });
  return ((listed?.conta_receber_cadastro ?? []) as any[])
    .filter((t) => t.codigo_lancamento_omie !== title.codigo_lancamento_omie)
    .filter((t) => {
      const other = boletoOf(t);
      return Boolean(other && ((boleto.numero && other.numero === boleto.numero) || (boleto.barras && other.barras === boleto.barras)));
    })
    .map((t) => `${t.codigo_lancamento_omie} (${t.status_titulo}, vence ${t.data_vencimento}, R$ ${t.valor_documento})`);
}

async function cancelReceivable(args: Record<string, unknown>, ctx: RunContext) {
  const motivo = String(args.motivo ?? "").trim();
  if (!motivo) throw new ToolRefusal("motivo must say why the title is being cancelled — it is written into the title's notes.");

  const key = args.codigo_lancamento_omie !== undefined
    ? { codigo_lancamento_omie: args.codigo_lancamento_omie }
    : { codigo_lancamento_integracao: args.codigo_lancamento_integracao };
  const title = await ctx.request(AR, "ConsultarContaReceber", key);
  const id = title?.codigo_lancamento_omie;
  if (typeof id !== "number") throw new ToolRefusal(`Omie returned no title for ${JSON.stringify(key)}.`);

  const status = normalizeStatus(title.status_titulo);
  if (status === "CANCELADO") {
    return { codigo_lancamento_omie: id, status_titulo: title.status_titulo, ja_cancelado: true, alteracoes: "nenhuma" };
  }
  if (!OPEN.has(status)) {
    throw new ToolRefusal(
      `Title ${id} is "${title.status_titulo}", not open. A title with a settlement (baixa) cannot be ` +
        "cancelled directly: undo the settlement first with cancel_receipt (codigo_baixa), then cancel."
    );
  }

  const boleto = boletoOf(title);
  if (boleto && args.confirmar_boleto !== boleto.token) {
    const shared = await openTitlesSharingBoleto(ctx, title, boleto);
    throw new ToolRefusal(
      `Title ${id} carries boleto ${boleto.numero ?? "(no number)"}${boleto.barras ? ` (barcode ${boleto.barras})` : ""}. ` +
        "Omie documents CancelarContaReceber as cancelling the generated boleto, so this may also request " +
        "its baixa at the bank. " +
        (shared.length > 0
          ? `WARNING: other open title(s) of this customer carry the SAME boleto: ${shared.join("; ")}. ` +
            "Cancelling may void the boleto those titles rely on — confirm with the person, or wait until it is paid. "
          : "No other open title of this customer carries it. ") +
        `To proceed, call again with confirmar_boleto: "${boleto.token}".`
    );
  }

  const note = [String(title.observacao ?? "").trim(), `Cancelamento solicitado: ${motivo}.`, ctx.attribution]
    .filter(Boolean)
    .join(" ");
  await ctx.request(AR, "AlterarContaReceber", { codigo_lancamento_omie: id, observacao: note });

  const resposta = await ctx.request(AR, "CancelarContaReceber", { chave_lancamento: id });
  if (String(resposta?.codigo_status ?? "") !== "0") {
    throw new Error(
      `CancelarContaReceber did not confirm for title ${id} (codigo_status ${resposta?.codigo_status}: ` +
        `${resposta?.descricao_status}). The cancellation note was already written to its observacao.`
    );
  }

  let verificacao: Record<string, unknown>;
  try {
    const today = omieDate(ctx.now);
    const listed = await ctx.request(AR, "ListarContasReceber", {
      pagina: 1,
      registros_por_pagina: 100,
      filtrar_cliente: title.codigo_cliente_fornecedor,
      filtrar_por_data_de: today,
      filtrar_por_data_ate: today,
    });
    const after = ((listed?.conta_receber_cadastro ?? []) as any[]).find((t) => t.codigo_lancamento_omie === id);
    verificacao = after
      ? { status_titulo: after.status_titulo, confirmado: normalizeStatus(after.status_titulo) === "CANCELADO" }
      : { confirmado: false, detalhe: "title not in today's change listing yet — check again with get_financial" };
  } catch (err) {
    verificacao = { confirmado: false, detalhe: `verification listing failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  return {
    codigo_lancamento_omie: id,
    status_anterior: title.status_titulo,
    resposta_omie: resposta,
    observacao_registrada: note,
    verificacao,
    aviso:
      "Omie answers this call with \"Boleto cancelado com sucesso!\" even for a title with no boleto; " +
      "status_titulo is what shows the title itself was cancelled.",
  };
}

export const cancellationTools: OmieTool[] = [
  {
    name: "cancel_account_receivable",
    description:
      "Cancel an accounts receivable title in Omie ERP (CancelarContaReceber) — status_titulo becomes " +
      "CANCELADO; the invoice (NF-e / NFS-e) it came from is NOT touched. Use it for a duplicated or wrong " +
      "title. Not the same as cancel_boleto, which only cancels the boleto, nor cancel_receipt, which undoes " +
      "a settlement. Checks first and refuses when the title is settled (undo with cancel_receipt first) or " +
      "carries a boleto (the refusal names it, lists other open titles sharing it, and says what to pass in " +
      "confirmar_boleto). Writes motivo and the caller into the title's notes, then confirms the new status.",
    path: AR,
    call: "CancelarContaReceber",
    inputSchema: {
      type: "object",
      properties: {
        codigo_lancamento_omie: { type: "number", description: "Omie title ID (codigo_lancamento_omie in get_financial / get_account_receivable)" },
        codigo_lancamento_integracao: { type: "string", description: "Title integration code (alternative)" },
        motivo: { type: "string", description: "Why the title is being cancelled, e.g. \"título duplicado; recebimento pelo título 123\". Written into the title's notes." },
        confirmar_boleto: {
          type: "string",
          description: "Only when the title carries a boleto: the boleto number the previous refusal asked for. Pass it only after the person has seen that warning.",
        },
      },
      required: ["motivo"],
      anyOfRequired: ["codigo_lancamento_omie", "codigo_lancamento_integracao"],
    },
    run: cancelReceivable,
  },
];
