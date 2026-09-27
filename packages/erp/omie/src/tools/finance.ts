import { OmieTool, listOnly, pagingSchema, withPaging, date, flag, notes, ID } from "./types.js";

const AR = "/financas/contareceber/";
const AP = "/financas/contapagar/";
const CC = "/financas/contacorrentelancamentos/";

/** Writable fields shared by the AR and AP title endpoints. */
const titleFields = {
  codigo_lancamento_integracao: { type: "string", description: "Integration code for the title (unique)" },
  codigo_cliente_fornecedor: { type: "number", description: `Customer (AR) or supplier (AP): ${ID.customer}` },
  data_vencimento: date("Due date"),
  valor_documento: { type: "number", description: "Document value in BRL" },
  codigo_categoria: { type: "string", description: "Category code from the chart of accounts (list_categories)" },
  data_previsao: date("Expected settlement date"),
  id_conta_corrente: { type: "number", description: ID.bankAccount },
  data_emissao: date("Issue date"),
  numero_documento: { type: "string", description: "Document / invoice number" },
  numero_parcela: { type: "string", description: "Installment marker, e.g. \"001/001\"" },
  codigo_tipo_documento: { type: "string", description: "Document type (see /geral/tiposdoc/)" },
  codigo_projeto: { type: "number", description: "Project ID" },
  observacao: { type: "string", description: "Notes" },
} as const;

/** Identifies a title by Omie ID or integration code. */
const titleKey = {
  codigo_lancamento_omie: {
    type: "number",
    description: "Omie title ID — codigo_lancamento_omie from get_financial (AR) or list_accounts_payable (AP); nCodTitulo in list_financial_movements is the same value",
  },
  codigo_lancamento_integracao: { type: "string", description: "Integration code (alternative)" },
} as const;
const titleKeyRequired = ["codigo_lancamento_omie", "codigo_lancamento_integracao"] as const;

/**
 * Fields of a settlement (baixa). Shared shape between LancarRecebimento and
 * LancarPagamento: `codigo_baixa` is the integer Omie assigns, while an
 * integration supplies `codigo_baixa_integracao`.
 */
function settlementFields(kind: "receipt" | "payment") {
  const verb = kind === "receipt" ? "received" : "paid";
  return {
    codigo_lancamento: { type: "number", description: "Title ID to settle — the same value as codigo_lancamento_omie" },
    codigo_lancamento_integracao: { type: "string", description: "Title integration code (alternative to codigo_lancamento)" },
    codigo_baixa: { type: "number", description: "Omie-assigned settlement ID" },
    codigo_baixa_integracao: { type: "string", description: "Settlement integration code — this is what an integration supplies" },
    codigo_conta_corrente: { type: "number", description: `${ID.bankAccount} — the account the amount was ${verb} into` },
    valor: { type: "number", description: `Amount ${verb} in BRL` },
    juros: { type: "number", description: "Interest amount" },
    desconto: { type: "number", description: "Discount amount" },
    multa: { type: "number", description: "Penalty amount" },
    data: date("Settlement date"),
    observacao: { type: "string", description: "Settlement notes" },
    conciliar_documento: flag(
      kind === "receipt"
        ? "S = post the settlement already reconciled with the bank. Can also be done later with reconcile_receipt"
        : "S = post the payment already reconciled with the bank. The ONLY way the API reconciles a payment: " +
            "Omie has no ConciliarPagamento, so one settled without it stays unreconciled until done in Omie's screen"
    ),
  };
}

/**
 * The /financas/resumo/ responses carry cUrlLogoBanco: a pre-signed S3 URL for
 * the bank's logo, with Omie's AWSAccessKeyId and Signature in the query
 * string. Useless to an agent, and a credential-shaped string it has no reason
 * to hold or repeat — dropped wherever it appears in the response.
 */
function withoutBankLogo(value: any): any {
  if (Array.isArray(value)) return value.map(withoutBankLogo);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).filter(([k]) => k !== "cUrlLogoBanco").map(([k, v]) => [k, withoutBankLogo(v)])
  );
}

export const financeTools: OmieTool[] = [
  // --- Accounts receivable ---------------------------------------------------
  {
    name: "get_financial",
    description:
      "List or search accounts receivable titles in Omie ERP (ListarContasReceber) by customer, status, " +
      "issue date or inclusion/change date. Returns codigo_lancamento_omie — the AR title ID every other " +
      "AR, boleto and PIX tool takes. Which AR read to use: one known title → get_account_receivable; " +
      "due-date ranges, all overdue titles, or AR and AP together → list_financial_movements (the only " +
      "one with a due-date filter); titles falling due on one given day → list_open_titles. Note " +
      "`filtrar_por_data_*` filters on inclusion/change date, while `filtrar_por_emissao_*` filters on the " +
      "issue date.",
    path: AR,
    call: "ListarContasReceber",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        filtrar_por_emissao_de: date("Issue date from"),
        filtrar_por_emissao_ate: date("Issue date to"),
        filtrar_por_data_de: date("Inclusion / change date from"),
        filtrar_por_data_ate: date("Inclusion / change date to"),
        filtrar_por_status: {
          type: "string",
          description: "Title status (RECEBIDO, ATRASADO, AVENCER, VENCEHOJE, EMABERTO, CANCELADO, ...). Rows spell it status_titulo \"A VENCER\", with a space",
        },
        filtrar_apenas_titulos_em_aberto: flag("Only titles still open"),
        filtrar_cliente: { type: "number", description: `Filter by ${ID.customer}` },
        filtrar_por_cpf_cnpj: { type: "string", description: "Filter by customer CPF / CNPJ" },
        filtrar_conta_corrente: { type: "number", description: "Filter by bank account ID" },
        filtrar_por_projeto: { type: "number", description: "Filter by project ID" },
        exibir_obs: flag("Include the entry notes"),
      },
    },
    param: withPaging("snake"),
  },
  {
    name: "create_account_receivable",
    description:
      "Create an accounts receivable (AR) title in Omie ERP (IncluirContaReceber) — the counterpart of " +
      "create_account_payable.",
    path: AR,
    call: "IncluirContaReceber",
    inputSchema: {
      type: "object",
      properties: titleFields,
      required: ["codigo_lancamento_integracao", "codigo_cliente_fornecedor", "data_vencimento", "valor_documento", "codigo_categoria"],
    },
    notes: notes("always", "observacao"),
  },
  {
    name: "get_account_receivable",
    description:
      "Consult a single accounts receivable title in Omie ERP (ConsultarContaReceber). Right after a write " +
      "to the title this may still return the previous state for a few seconds, and repeating the identical " +
      "call at once is refused (REDUNDANT) — to confirm a change just made, use get_financial filtered by " +
      "customer instead.",
    path: AR,
    call: "ConsultarContaReceber",
    inputSchema: { type: "object", properties: titleKey, anyOfRequired: titleKeyRequired },
  },
  {
    name: "update_account_receivable",
    description:
      "Update an accounts receivable title in Omie ERP (AlterarContaReceber). " +
      "Sending observacao REPLACES the notes the title has — read it first and send the old text plus the addition.",
    path: AR,
    call: "AlterarContaReceber",
    inputSchema: {
      type: "object",
      properties: { codigo_lancamento_omie: titleKey.codigo_lancamento_omie, ...titleFields },
      anyOfRequired: titleKeyRequired,
    },
    notes: notes("if-present", "observacao"),
  },
  {
    name: "receive_account_receivable",
    description:
      "Settle / record a receipt (baixa) against an AR title in Omie ERP (LancarRecebimento). Identify " +
      "the title with codigo_lancamento or codigo_lancamento_integracao — without one of them the " +
      "settlement has no target. Moves money: the title becomes RECEBIDO (or partially received) and a " +
      "bank-ledger entry is posted. Read the title first to check it is still open, and never repeat the " +
      "call after an error — re-read instead. Keep codigo_baixa from the response: it is what cancel_receipt " +
      "needs to undo this.",
    path: AR,
    call: "LancarRecebimento",
    inputSchema: {
      type: "object",
      properties: settlementFields("receipt"),
      required: ["valor", "data", "codigo_conta_corrente"],
      anyOfRequired: ["codigo_lancamento", "codigo_lancamento_integracao"],
    },
    // A settlement is a new record, so the notes field starts empty.
    notes: notes("always", "observacao"),
  },
  {
    name: "cancel_receipt",
    description:
      "Undo a receipt (baixa) previously settled on an AR title in Omie ERP (CancelarRecebimento) — the " +
      "title goes back to open. This does not cancel the title: to do that afterwards, use " +
      "cancel_account_receivable. codigo_baixa comes from receive_account_receivable's response or from " +
      "list_financial_movements (nCodBaixa).",
    path: AR,
    call: "CancelarRecebimento",
    inputSchema: {
      type: "object",
      properties: {
        codigo_baixa: { type: "number", description: ID.arSettlement },
        codigo_baixa_integracao: { type: "string", description: "Settlement integration code, if one was given (alternative)" },
      },
      anyOfRequired: ["codigo_baixa", "codigo_baixa_integracao"],
    },
  },

  // --- Accounts payable ------------------------------------------------------
  {
    name: "create_account_payable",
    description:
      "Create an accounts payable (AP) title in Omie ERP (IncluirContaPagar). Returns codigo_lancamento_omie. " +
      "Check first with list_accounts_payable that the bill is not already registered.",
    path: AP,
    call: "IncluirContaPagar",
    inputSchema: {
      type: "object",
      properties: {
        codigo_lancamento_integracao: { type: "string", description: "Integration code (unique)" },
        codigo_cliente_fornecedor: { type: "number", description: `Supplier: ${ID.customer} (suppliers are customer records)` },
        data_vencimento: date("Due date"),
        valor_documento: { type: "number", description: "Document value in BRL" },
        codigo_categoria: { type: "string", description: "Category code (chart of accounts)" },
        data_previsao: date("Expected payment date"),
        id_conta_corrente: { type: "number", description: ID.bankAccount },
        numero_documento: { type: "string", description: "Document/invoice number" },
        observacao: { type: "string", description: "Notes" },
      },
      required: ["codigo_lancamento_integracao", "codigo_cliente_fornecedor", "data_vencimento", "valor_documento", "codigo_categoria"],
    },
    notes: notes("always", "observacao"),
  },
  {
    name: "list_accounts_payable",
    description:
      "List accounts payable (AP) titles in Omie ERP (ListarContasPagar); returns codigo_lancamento_omie " +
      "per title. This endpoint has no due-date filter — to select " +
      "titles by vencimento use list_financial_movements, which accepts dDtVencDe / dDtVencAte.",
    path: AP,
    call: "ListarContasPagar",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        filtrar_por_status: {
          type: "string",
          description:
            "Title status: CANCELADO, PAGO, LIQUIDADO, EMABERTO, ATRASADO, VENCEHOJE, AVENCER, PAGTOPARCIAL. PAGO and " +
            "LIQUIDADO also match a title paid and later cancelled — check status_titulo on each row",
        },
        filtrar_por_emissao_de: date("Issue date from"),
        filtrar_por_emissao_ate: date("Issue date to"),
        filtrar_por_data_de: date("Inclusion / change date from"),
        filtrar_por_data_ate: date("Inclusion / change date to"),
        filtrar_cliente: { type: "number", description: "Filter by supplier ID" },
        filtrar_por_cpf_cnpj: { type: "string", description: "Filter by supplier CPF / CNPJ" },
        filtrar_conta_corrente: { type: "number", description: "Filter by bank account ID" },
        filtrar_por_projeto: { type: "number", description: "Filter by project ID" },
        exibir_obs: flag("Include the entry notes"),
      },
    },
    param: withPaging("snake"),
  },
  {
    name: "get_account_payable",
    description: "Consult a single accounts payable title in Omie ERP (ConsultarContaPagar)",
    path: AP,
    call: "ConsultarContaPagar",
    inputSchema: { type: "object", properties: titleKey, anyOfRequired: titleKeyRequired },
  },
  {
    name: "update_account_payable",
    description:
      "Update an accounts payable title in Omie ERP (AlterarContaPagar). " +
      "Sending observacao REPLACES the notes the title has — read it first and send the old text plus the addition.",
    path: AP,
    call: "AlterarContaPagar",
    inputSchema: {
      type: "object",
      properties: { codigo_lancamento_omie: titleKey.codigo_lancamento_omie, ...titleFields },
      anyOfRequired: titleKeyRequired,
    },
    notes: notes("if-present", "observacao"),
  },
  {
    name: "pay_account_payable",
    description:
      "Settle / record payment (baixa) for an AP title in Omie ERP (LancarPagamento). Identify the title " +
      "with codigo_lancamento or codigo_lancamento_integracao — without one of them the settlement has " +
      "no target. Supply your own reference in codigo_baixa_integracao; codigo_baixa is the integer Omie " +
      "assigns. Moves money: the title becomes PAGO (or partially paid) and a bank-ledger entry is posted. " +
      "Never repeat the call after an error — re-read the title instead. Undo with cancel_payment. To have " +
      "it reconciled with the bank, send conciliar_documento=S now: the API cannot reconcile a payment afterwards.",
    path: AP,
    call: "LancarPagamento",
    inputSchema: {
      type: "object",
      properties: settlementFields("payment"),
      required: ["valor", "data", "codigo_conta_corrente"],
      anyOfRequired: ["codigo_lancamento", "codigo_lancamento_integracao"],
    },
    notes: notes("always", "observacao"),
  },
  {
    name: "cancel_payment",
    description:
      "Undo a payment (baixa) previously settled on an AP title in Omie ERP (CancelarPagamento) — the title " +
      "goes back to open. codigo_baixa comes from pay_account_payable's response or from " +
      "list_financial_movements (nCodBaixa).",
    path: AP,
    call: "CancelarPagamento",
    inputSchema: {
      type: "object",
      properties: {
        codigo_baixa: { type: "number", description: ID.apSettlement },
        codigo_baixa_integracao: { type: "string", description: "Settlement integration code, if one was given (alternative)" },
      },
      anyOfRequired: ["codigo_baixa", "codigo_baixa_integracao"],
    },
  },

  // --- Bank account ledger ---------------------------------------------------
  {
    name: "create_cash_entry",
    description:
      "Create a bank account ledger entry (lançamento de conta corrente) in Omie ERP (IncluirLancCC). " +
      "Note that cCodIntLanc sits at the top level, not inside cabecalho, and that the direction of the " +
      "entry comes from the sign of nValorLanc — there is no cNatureza field.",
    path: CC,
    call: "IncluirLancCC",
    inputSchema: {
      type: "object",
      properties: {
        cCodIntLanc: { type: "string", description: "Integration code for the entry (unique, max 20 chars)" },
        cabecalho: {
          type: "object",
          description: "Entry header — accepts only these three fields",
          properties: {
            nCodCC: { type: "number", description: ID.bankAccount },
            dDtLanc: date("Entry date"),
            nValorLanc: { type: "number", description: "Entry amount in BRL; negative for an outflow" },
          },
          required: ["nCodCC", "dDtLanc", "nValorLanc"],
        },
        detalhes: {
          type: "object",
          description: "Entry details",
          properties: {
            cCodCateg: { type: "string", description: "Category code from the chart of accounts (list_categories)" },
            cTipo: { type: "string", description: "Document type: DIN=dinheiro, BOL=boleto, CRT=cartão, CHQ=cheque, CON=convênio, ADI=adiantamento, ..." },
            cNumDoc: { type: "string", description: "Document number" },
            nCodCliente: { type: "number", description: `Customer / payee: ${ID.customer}` },
            nCodProjeto: { type: "number", description: "Project ID" },
            cObs: { type: "string", description: "Notes — this is where a free-text history line goes" },
            aCodCateg: {
              type: "array",
              description: "Split across several categories, instead of a single cCodCateg",
              items: {
                type: "object",
                properties: {
                  cCodCateg: { type: "string", description: "Category code" },
                  nValor: { type: "number", description: "Amount for this category" },
                  nPerc: { type: "number", description: "Percent for this category" },
                },
              },
            },
          },
        },
        departamentos: {
          type: "array",
          description: "Cost-center split",
          items: {
            type: "object",
            properties: {
              cCodDep: { type: "string", description: "Department code (list_departments)" },
              nValDep: { type: "number", description: "Amount for this department" },
              nPerDep: { type: "number", description: "Percent for this department" },
            },
          },
        },
        transferencia: {
          type: "object",
          description: "Turns the entry into a transfer between accounts",
          properties: {
            nCodCCDestino: { type: "number", description: "Destination bank account ID" },
          },
        },
      },
      required: ["cCodIntLanc", "cabecalho"],
    },
    // if-parent-present, not always: `detalhes` is optional here and also
    // carries cCodCateg/cTipo/cNumDoc, so creating it just to hold a note
    // would send Omie a categoryless detail block instead of none at all.
    notes: notes("if-parent-present", "detalhes", "cObs"),
  },
  {
    name: "list_cash_entries",
    description:
      "List bank account ledger entries in Omie ERP (ListarLancCC), keyed by nCodLanc — both the manual ones " +
      "create_cash_entry makes and the ones each AR/AP settlement posts. A settlement's entry has " +
      "diversos.cOrigem BAXR / BAXP (origins Omie's docs leave out; filter cOrigem to see one kind) and the " +
      "title in diversos.nCodLancCR / nCodLancCP; diversos.dDtConc is the reconciliation date, empty while the " +
      "entry is unreconciled. The settlement ID (nCodBaixa) is not here: see list_financial_movements, or " +
      "list_unreconciled_entries for what is pending reconciliation.",
    path: CC,
    call: "ListarLancCC",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("n"),
        dtPagInicial: date("Payment date from"),
        dtPagFinal: date("Payment date to"),
        dDtIncDe: date("Inclusion date from"),
        dDtIncAte: date("Inclusion date to"),
        cOrigem: {
          type: "string",
          description:
            "Entry origin code, 4 chars: BAXR / BAXP = AR / AP settlement, EXTR / EXTP = manual receipt / expense, " +
            "TRAR / TRAP = transfer in / out, DEVP = sales-return payable, ...",
        },
      },
    },
    param: withPaging("n"),
  },
  {
    name: "get_cash_entry",
    description:
      "Consult a single bank account ledger entry in Omie ERP (ConsultaLancCC) — manual or posted by an " +
      "AR/AP settlement. Every line of get_bank_statement is one of these (its nCodLancamento is the " +
      "nCodLanc here). diversos.dDtConc / cHrConc / cUsConc say when and by whom it was reconciled, empty " +
      "while it is not; diversos.nCodLancCR / nCodLancCP name the title whose settlement posted it. This " +
      "is how to confirm that reconcile_receipt or unreconcile_receipt took effect.",
    path: CC,
    call: "ConsultaLancCC",
    inputSchema: {
      type: "object",
      properties: {
        nCodLanc: { type: "number", description: ID.cashEntry },
        cCodIntLanc: { type: "string", description: "Integration code, for an entry created with one (alternative)" },
      },
      anyOfRequired: ["nCodLanc", "cCodIntLanc"],
    },
  },
  {
    name: "update_cash_entry",
    description:
      "Update a manual bank account ledger entry in Omie ERP (AlterarLancCC). Sending detalhes.cObs " +
      "REPLACES the entry's notes — read it first and send the old text plus the addition.",
    path: CC,
    call: "AlterarLancCC",
    inputSchema: {
      type: "object",
      properties: {
        cCodIntLanc: { type: "string", description: "Integration code of the entry to change" },
        nCodLanc: { type: "number", description: "Omie entry ID (alternative to cCodIntLanc)" },
        cabecalho: {
          type: "object",
          properties: {
            nCodCC: { type: "number", description: "Bank account ID" },
            dDtLanc: date("Entry date"),
            nValorLanc: { type: "number", description: "Entry amount in BRL" },
          },
        },
        detalhes: {
          type: "object",
          properties: {
            cCodCateg: { type: "string", description: "Category code" },
            cTipo: { type: "string", description: "Document type (DIN, BOL, CRT, CHQ, ...)" },
            cNumDoc: { type: "string", description: "Document number" },
            nCodCliente: { type: "number", description: "Customer / payee ID" },
            nCodProjeto: { type: "number", description: "Project ID" },
            cObs: { type: "string", description: "Notes" },
          },
        },
      },
      anyOfRequired: ["cCodIntLanc", "nCodLanc"],
    },
    notes: notes("if-present", "detalhes", "cObs"),
  },
  {
    name: "delete_cash_entry",
    description:
      "Permanently delete a manual bank account ledger entry in Omie ERP (ExcluirLancCC) — irreversible. " +
      "Not for undoing a title settlement: that is cancel_receipt (AR) or cancel_payment (AP).",
    path: CC,
    call: "ExcluirLancCC",
    inputSchema: {
      type: "object",
      properties: {
        nCodLanc: { type: "number", description: "Omie entry ID" },
        cCodIntLanc: { type: "string", description: "Integration code (alternative)" },
      },
      anyOfRequired: ["nCodLanc", "cCodIntLanc"],
    },
  },

  // --- Cross-cutting views ---------------------------------------------------
  {
    name: "list_financial_movements",
    description:
      "List unified financial movements (AP + AR + CC) in Omie ERP (ListarMovimentos). Each row carries " +
      "nCodTitulo (the title ID, = codigo_lancamento_omie) and, once settled, nCodBaixa (the settlement ID " +
      "cancel_receipt / cancel_payment take). This is also the only endpoint with " +
      "a due-date filter (dDtVencDe / dDtVencAte), and the right one for \"which receivables are overdue\": " +
      "cNatureza=R + cStatus=ATRASADO. By default Omie mixes titles with their settlements and bank-ledger " +
      "rows (cGrupo CONTA_CORRENTE_*), applies cStatus to the titles only, and pages the two groups " +
      "separately — so this tool sends cTpLancamento=CR / CP / CPCR (titles only) whenever cStatus is " +
      "given without one; pass cTpLancamento yourself for settlements (BXCR / BXCP) or ledger rows (CC). " +
      "Omie's docs state no default date window, and in production the unfiltered call returned titles issued " +
      "and paid seven weeks earlier: pass the date range you mean rather than relying on a default.",
    path: "/financas/mf/",
    call: "ListarMovimentos",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("n"),
        dDtVencDe: date("Due date from"),
        dDtVencAte: date("Due date to"),
        dDtPagtoDe: date("Payment date from"),
        dDtPagtoAte: date("Payment date to"),
        dDtEmisDe: date("Issue date from"),
        dDtEmisAte: date("Issue date to"),
        cNatureza: { type: "string", enum: ["P", "R"], description: "Nature: P=payable, R=receivable. Omit for both" },
        cStatus: { type: "string", description: "Status: CANCELADO, RECEBIDO, PAGO, VENCEHOJE, AVENCER, ATRASADO, EMABERTO, PAGTOPARCIAL" },
        cTpLancamento: {
          type: "string",
          enum: ["CP", "CR", "CPCR", "BX", "BXCP", "BXCR", "CC", "CCE", "CCS", "CCT", "PV", "POS", "PPV"],
          description:
            "Record type. Titles: CP=payables, CR=receivables, CPCR=both. Settlements (baixas): BX=both, " +
            "BXCP, BXCR. Bank ledger: CC=all, CCE=in, CCS=out, CCT=transfers. Forecasts: PV=service " +
            "contracts, POS=service orders, PPV=sales orders. Defaults to titles when cStatus is set",
        },
        nCodCliente: { type: "number", description: `Filter by ${ID.customer}` },
        cCPFCNPJCliente: { type: "string", description: "Filter by customer / supplier CPF / CNPJ" },
        nCodCC: { type: "number", description: `Filter by ${ID.bankAccount}` },
        nCodMovCC: { type: "number", description: `Filter by one ${ID.cashEntry} — with cTpLancamento BXCR / BXCP, the settlement that posted it` },
        cCodCateg: { type: "string", description: "Filter by category code" },
        cExibirDepartamentos: flag("Include the department split"),
      },
    },
    param: (args) => {
      const param = withPaging("n")(args) as Record<string, unknown>;
      // Seen in production 2026-09-27: cNatureza=R + cStatus=ATRASADO returned
      // the 2 overdue titles plus 7 RECEBIDO settlement rows, on a second page.
      // cStatus is a title filter, so without a record type it is answering a
      // different question than the one asked.
      if (args.cStatus !== undefined && args.cTpLancamento === undefined) {
        param.cTpLancamento = args.cNatureza === "R" ? "CR" : args.cNatureza === "P" ? "CP" : "CPCR";
      }
      return param;
    },
  },
  {
    name: "get_bank_statement",
    description:
      "Retrieve a bank account statement (extrato) for a period from Omie ERP (ListarExtrato) — every credit " +
      "and debit with the running balance, reconciled or not (each row's cSituacao says which). Identify the " +
      "account with nCodCC or cCodIntCC — Omie refuses the call without one.",
    path: "/financas/extrato/",
    call: "ListarExtrato",
    inputSchema: {
      type: "object",
      properties: {
        nCodCC: { type: "number", description: ID.bankAccount },
        cCodIntCC: { type: "string", description: "Bank account integration code (alternative to nCodCC)" },
        dPeriodoInicial: date("Start date"),
        dPeriodoFinal: date("End date"),
        cExibirApenasSaldo: flag("Show only balances"),
      },
      required: ["dPeriodoInicial", "dPeriodoFinal"],
      anyOfRequired: ["nCodCC", "cCodIntCC"],
    },
  },
  {
    name: "get_finance_summary",
    description:
      "Get the consolidated finance position in Omie ERP (ObterResumoFinancas) — balances, AR/AP totals and a " +
      "10-day cash flow rather than a title-by-title listing. The balances and totals are the current ones; " +
      "dDia (default today) only moves where the cash flow starts. lApenasResumo=false adds the overdue lists " +
      "(contaReceberAtraso / contaPagarAtraso), and only then does lExibirCategoria=true fill the per-category " +
      "totals.",
    path: "/financas/resumo/",
    call: "ObterResumoFinancas",
    transform: withoutBankLogo,
    inputSchema: {
      type: "object",
      properties: {
        dDia: date("First day of the cash flow; defaults to today"),
        lApenasResumo: { type: "boolean", description: "Summary only (default true, Omie's own default); false adds the overdue lists" },
        lExibirCategoria: { type: "boolean", description: "Break the totals down by category — takes effect only with lApenasResumo=false" },
      },
    },
    // Production, 2026-09-27: with no arguments the param is {} and Omie answers
    // "Nenhum parâmetro foi recebido em WS_PARAMS!". Sending the documented
    // default makes the argument-less call — "today's position" — work.
    param: (args) => ({ ...args, lApenasResumo: args.lApenasResumo ?? true }),
  },
  {
    name: "list_open_titles",
    description:
      "List the open titles falling due on ONE day in Omie ERP (ObterListaEmAberto) — the dashboard's " +
      "\"to collect / to pay today\" list, NOT every open or overdue title: a title that fell due on an " +
      "earlier day does not appear (on a weekend dDia it shows the last business day). Its nDiasAtraso " +
      "comes back 0 even for overdue titles. For all overdue receivables use list_financial_movements " +
      "with cNatureza=R and cStatus=ATRASADO. cTipo (required) selects P (payables) or R (receivables); " +
      "each row's title ID is nIdTitulo (= codigo_lancamento_omie).",
    path: "/financas/resumo/",
    call: "ObterListaEmAberto",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("n"),
        dDia: date("The due date to list (Omie calls it \"data de registro\"); defaults to today"),
        cTipo: { type: "string", enum: ["P", "R"], description: "P=payables, R=receivables — required" },
        nCodCliente: { type: "number", description: `Filter by ${ID.customer}` },
        cNomeCliente: { type: "string", description: "Filter by customer / supplier name" },
      },
      required: ["cTipo"],
    },
    param: withPaging("n"),
    transform: withoutBankLogo,
  },
];
