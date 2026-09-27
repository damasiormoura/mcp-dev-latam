import { OmieTool, RunContext, ToolRefusal, date, ID } from "./types.js";

const AR = "/financas/contareceber/";
const EXTRATO = "/financas/extrato/";
const MF = "/financas/mf/";

/**
 * Bank reconciliation (conciliação bancária) as far as Omie's API allows it.
 *
 * Checked against Omie's published reference on 2026-09-27, across all 138
 * endpoints:
 *
 *   - AR settlements can be reconciled and unreconciled after the fact:
 *     ConciliarRecebimento / DesconciliarRecebimento, keyed by the settlement
 *     (codigo_baixa). reconcile_receipt / unreconcile_receipt wrap them.
 *   - AP settlements cannot: /financas/contapagar/ has no Conciliar* method.
 *     The only way is conciliar_documento=S on the settlement itself
 *     (pay_account_payable).
 *   - Manual bank-ledger entries cannot either: IncluirLancCC / AlterarLancCC
 *     do not accept the `diversos` block that carries dDtConc.
 *   - There is no statement (OFX) import and no matching engine; Omie's
 *     Conciliação Bancária screen is not exposed. The bank's side has to come
 *     from outside, and the person decides what matches.
 *
 * What the API does give is the Omie side of the picture, split across two
 * reads that have to be joined, which is what list_unreconciled_entries does:
 *
 *   ListarExtrato — one row per bank-ledger entry, with cSituacao ("Não
 *     conciliado", "Previsto", ...), plus a "SALDO" row per day. Has the
 *     reconciliation state but not the settlement ID.
 *   ListarMovimentos (cTpLancamento=BX) — one row per settlement, with
 *     nCodBaixa (what ConciliarRecebimento takes) and nCodMovCC. Has the
 *     settlement ID but not the reconciliation state.
 *
 * Seen in production on 2026-09-27: every extrato nCodLancamento of a settled
 * title is the nCodMovCC of its settlement in ListarMovimentos (and the nCodLanc
 * of ListarLancCC / ConsultaLancCC), and the settlement's dDtPagamento is the
 * extrato row's date — so the period's settlements, filtered by account, cover
 * the period's extrato rows.
 */

/** Settlements are paged at Omie's cap; this bounds one call to 1000 of them. */
const MAX_SETTLEMENT_PAGES = 10;

/** "Não conciliado" → "NAO CONCILIADO": Omie's labels carry accents and inconsistent case. */
function normalize(label: unknown): string {
  return String(label ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The daily "SALDO" / "SALDO ANTERIOR" rows the extrato interleaves with the entries. */
function isBalanceRow(row: any): boolean {
  return !row?.cSituacao && /^SALDO( ANTERIOR)?$/.test(normalize(row?.cDesCliente));
}

async function settlementsOf(ctx: RunContext, nCodCC: unknown, de: unknown, ate: unknown) {
  const byMovCC = new Map<number, any>();
  let pagina = 1;
  let totalPaginas = 1;
  do {
    const page = await ctx.request(MF, "ListarMovimentos", {
      nPagina: pagina,
      nRegPorPagina: 100,
      cTpLancamento: "BX",
      nCodCC,
      dDtPagtoDe: de,
      dDtPagtoAte: ate,
    });
    for (const m of (page?.movimentos ?? []) as any[]) {
      const d = m?.detalhes ?? {};
      // Filtered on the account already; checked again because a settlement on
      // another account with a colliding nCodMovCC would be a wrong codigo_baixa.
      if (typeof d.nCodMovCC === "number" && d.nCodCC === nCodCC) byMovCC.set(d.nCodMovCC, d);
    }
    totalPaginas = Number(page?.nTotPaginas ?? 1);
    pagina++;
  } while (pagina <= totalPaginas && pagina <= MAX_SETTLEMENT_PAGES);
  return { byMovCC, truncated: totalPaginas > MAX_SETTLEMENT_PAGES };
}

function classify(row: any, settlement: any | undefined) {
  const id = row.nCodLancamento;
  if (settlement?.cNatureza === "R" && typeof settlement.nCodBaixa === "number") {
    return {
      tipo: "recebimento",
      nCodTitulo: settlement.nCodTitulo,
      nCodBaixa: settlement.nCodBaixa,
      conciliavel_via_api: true,
      como_conciliar: `reconcile_receipt with codigo_baixa ${settlement.nCodBaixa}, after the person confirms it matches the bank`,
    };
  }
  if (settlement?.cNatureza === "P") {
    return {
      tipo: "pagamento",
      nCodTitulo: settlement.nCodTitulo,
      nCodBaixa: settlement.nCodBaixa,
      conciliavel_via_api: false,
      como_conciliar:
        "AP payment: Omie's API cannot reconcile a payment after it is settled (there is no ConciliarPagamento) — " +
        "reconcile it in Omie's Conciliação Bancária screen",
    };
  }
  if (row.cNatureza === "R" && /RECEBIDA/.test(normalize(row.cOrigem))) {
    return {
      tipo: "recebimento",
      conciliavel_via_api: false,
      como_conciliar:
        `Its settlement was not among this account's settlements dated in the period. Find it with ` +
        `list_financial_movements (nCodMovCC ${id}, cTpLancamento BXCR); with its nCodBaixa, reconcile_receipt can reconcile it`,
    };
  }
  return {
    tipo: row.cNatureza === "P" && /PAGA/.test(normalize(row.cOrigem)) ? "pagamento" : "lancamento_cc",
    conciliavel_via_api: false,
    como_conciliar:
      "Not an AR settlement (a payment, a manual ledger entry or a transfer): the API cannot reconcile it — " +
      "use Omie's Conciliação Bancária screen",
  };
}

async function listUnreconciled(args: Record<string, unknown>, ctx: RunContext) {
  const account = args.nCodCC !== undefined ? { nCodCC: args.nCodCC } : { cCodIntCC: args.cCodIntCC };
  const extrato = await ctx.request(EXTRATO, "ListarExtrato", {
    ...account,
    dPeriodoInicial: args.dPeriodoInicial,
    dPeriodoFinal: args.dPeriodoFinal,
  });
  const nCodCC = extrato?.nCodCC;
  if (typeof nCodCC !== "number") throw new ToolRefusal(`Omie returned no bank account for ${JSON.stringify(account)}.`);

  const rows = ((extrato?.listaMovimentos ?? []) as any[]).filter((r) => !isBalanceRow(r));
  const porSituacao: Record<string, number> = {};
  for (const r of rows) {
    const label = r.cSituacao || "(sem situação)";
    porSituacao[label] = (porSituacao[label] ?? 0) + 1;
  }
  const unreconciled = rows.filter((r) => normalize(r.cSituacao) === "NAO CONCILIADO");

  // Only worth the second read when there is something to resolve.
  const { byMovCC, truncated } = unreconciled.length > 0
    ? await settlementsOf(ctx, nCodCC, args.dPeriodoInicial, args.dPeriodoFinal)
    : { byMovCC: new Map<number, any>(), truncated: false };

  const pendentes = unreconciled.map((r) => ({
    nCodLancamento: r.nCodLancamento,
    dDataLancamento: r.dDataLancamento,
    nValorDocumento: r.nValorDocumento,
    cNatureza: r.cNatureza,
    cOrigem: r.cOrigem,
    cRazCliente: r.cRazCliente || r.cDesCliente,
    cDocCliente: r.cDocCliente,
    cTipoDocumento: r.cTipoDocumento,
    cNumero: r.cNumero,
    cDocumentoFiscal: r.cDocumentoFiscal,
    cDesCategoria: r.cDesCategoria,
    ...classify(r, byMovCC.get(r.nCodLancamento)),
  }));

  // Only ever given rows already filtered on Number(nValorDocumento) > 0 or < 0, so the value is always there.
  const soma = (xs: any[]) => Math.round(xs.reduce((s, p) => s + Number(p.nValorDocumento), 0) * 100) / 100;
  return {
    conta: {
      nCodCC,
      cDescricao: extrato.cDescricao,
      nCodBanco: extrato.nCodBanco,
      nCodAgencia: extrato.nCodAgencia,
      nNumConta: extrato.nNumConta,
    },
    periodo: { de: extrato.dPeriodoInicial ?? args.dPeriodoInicial, ate: extrato.dPeriodoFinal ?? args.dPeriodoFinal },
    saldos: {
      nSaldoAtual: extrato.nSaldoAtual,
      nSaldoConciliado: extrato.nSaldoConciliado,
    },
    resumo: {
      lancamentos_no_periodo: rows.length,
      por_situacao: porSituacao,
      pendentes: pendentes.length,
      conciliaveis_via_api: pendentes.filter((p) => p.conciliavel_via_api).length,
      entradas_pendentes: soma(pendentes.filter((p) => Number(p.nValorDocumento) > 0)),
      saidas_pendentes: soma(pendentes.filter((p) => Number(p.nValorDocumento) < 0)),
    },
    pendentes,
    ...(truncated
      ? { aviso: `More than ${MAX_SETTLEMENT_PAGES * 100} settlements in the period; some rows may lack nCodBaixa — narrow the period.` }
      : {}),
  };
}

const settlementKey = (source: string) => ({
  type: "object",
  properties: {
    codigo_baixa: { type: "number", description: `${ID.arSettlement}; ${source}` },
    codigo_baixa_integracao: { type: "string", description: "Settlement integration code, if one was given (alternative)" },
  },
  anyOfRequired: ["codigo_baixa", "codigo_baixa_integracao"],
});

export const reconciliationTools: OmieTool[] = [
  {
    name: "list_unreconciled_entries",
    description:
      "List what is pending bank reconciliation on one bank account over a period in Omie ERP — the extrato " +
      "(ListarExtrato) rows still \"Não conciliado\". The daily SALDO rows and the forecasts (\"Previsto\") " +
      "are left out, and each row is joined with its settlement (ListarMovimentos), which is what gives it " +
      "nCodBaixa and nCodTitulo. Every row says whether the API can reconcile it (conciliavel_via_api) and how " +
      "(como_conciliar): an AR receipt can, with reconcile_receipt; an AP payment, a manual ledger entry or a " +
      "transfer cannot — Omie's API has no method for those. This is the Omie side only: whether a row " +
      "matches the bank's own statement is for the person to confirm before anything is reconciled.",
    path: EXTRATO,
    call: "ListarExtrato",
    inputSchema: {
      type: "object",
      properties: {
        nCodCC: { type: "number", description: ID.bankAccount },
        cCodIntCC: { type: "string", description: "Bank account integration code (alternative to nCodCC)" },
        dPeriodoInicial: date("Start date"),
        dPeriodoFinal: date("End date"),
      },
      required: ["dPeriodoInicial", "dPeriodoFinal"],
      anyOfRequired: ["nCodCC", "cCodIntCC"],
    },
    run: listUnreconciled,
  },
  {
    name: "reconcile_receipt",
    description:
      "Mark an AR settlement (baixa) as reconciled with the bank in Omie ERP (ConciliarRecebimento) — its " +
      "extrato row stops being \"Não conciliado\". Only for receipts: Omie has no equivalent for AP " +
      "payments (reconcile those at settlement time with pay_account_payable's conciliar_documento=S). " +
      "Confirm with the person that the entry matches the bank statement first — list_unreconciled_entries " +
      "lists the candidates with their codigo_baixa. Omie's reply is not proof: confirm with get_cash_entry " +
      "(diversos.dDtConc filled) or list_unreconciled_entries. Undo with unreconcile_receipt.",
    path: AR,
    call: "ConciliarRecebimento",
    inputSchema: settlementKey("list_unreconciled_entries gives it (nCodBaixa) for each receipt still unreconciled"),
  },
  {
    name: "unreconcile_receipt",
    description:
      "Undo the bank reconciliation of an AR settlement (baixa) in Omie ERP (DesconciliarRecebimento) — its " +
      "extrato row goes back to \"Não conciliado\"; the settlement itself stays (to undo that, cancel_receipt). " +
      "Confirm with get_cash_entry (diversos.dDtConc empty again).",
    path: AR,
    call: "DesconciliarRecebimento",
    inputSchema: settlementKey("the one reconcile_receipt was called with"),
  },
];
