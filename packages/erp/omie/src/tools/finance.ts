import { OmieTool, listOnly, pagingSchema, withPaging, date, flag } from "./types.js";

const AR = "/financas/contareceber/";
const AP = "/financas/contapagar/";
const CC = "/financas/contacorrentelancamentos/";

/** Writable fields shared by the AR and AP title endpoints. */
const titleFields = {
  codigo_lancamento_integracao: { type: "string", description: "Integration code for the title (unique)" },
  codigo_cliente_fornecedor: { type: "number", description: "Omie customer (AR) or supplier (AP) ID" },
  data_vencimento: date("Due date"),
  valor_documento: { type: "number", description: "Document value in BRL" },
  codigo_categoria: { type: "string", description: "Category code from the chart of accounts (list_categories)" },
  data_previsao: date("Expected settlement date"),
  id_conta_corrente: { type: "number", description: "Bank account ID (get_bank_accounts)" },
  data_emissao: date("Issue date"),
  numero_documento: { type: "string", description: "Document / invoice number" },
  numero_parcela: { type: "string", description: "Installment marker, e.g. \"001/001\"" },
  codigo_tipo_documento: { type: "string", description: "Document type (see /geral/tiposdoc/)" },
  codigo_projeto: { type: "number", description: "Project ID" },
  observacao: { type: "string", description: "Notes" },
} as const;

/** Identifies a title by Omie ID or integration code. */
const titleKey = {
  codigo_lancamento_omie: { type: "number", description: "Omie title ID" },
  codigo_lancamento_integracao: { type: "string", description: "Integration code (alternative)" },
} as const;

/**
 * Fields of a settlement (baixa). Shared shape between LancarRecebimento and
 * LancarPagamento: `codigo_baixa` is the integer Omie assigns, while an
 * integration supplies `codigo_baixa_integracao`.
 */
function settlementFields(kind: "receipt" | "payment") {
  const verb = kind === "receipt" ? "received" : "paid";
  return {
    codigo_lancamento: { type: "number", description: "Omie title ID to settle" },
    codigo_lancamento_integracao: { type: "string", description: "Title integration code (alternative to codigo_lancamento)" },
    codigo_baixa: { type: "number", description: "Omie-assigned settlement ID" },
    codigo_baixa_integracao: { type: "string", description: "Settlement integration code — this is what an integration supplies" },
    codigo_conta_corrente: { type: "number", description: `Bank account ID the amount was ${verb} into` },
    valor: { type: "number", description: `Amount ${verb} in BRL` },
    juros: { type: "number", description: "Interest amount" },
    desconto: { type: "number", description: "Discount amount" },
    multa: { type: "number", description: "Penalty amount" },
    data: date("Settlement date"),
    observacao: { type: "string", description: "Settlement notes" },
    conciliar_documento: flag("Reconcile the document automatically"),
  };
}

export const financeTools: OmieTool[] = [
  // --- Accounts receivable ---------------------------------------------------
  {
    name: "get_financial",
    description: "List accounts receivable from Omie ERP",
    path: AR,
    call: "ListarContasReceber",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        dDtEmiInicial: date("Start emission date"),
        dDtEmiFinal: date("End emission date"),
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
  },
  {
    name: "get_account_receivable",
    description: "Consult a single accounts receivable title in Omie ERP",
    path: AR,
    call: "ConsultarContaReceber",
    inputSchema: { type: "object", properties: titleKey },
  },
  {
    name: "update_account_receivable",
    description: "Update an accounts receivable title in Omie ERP (AlterarContaReceber)",
    path: AR,
    call: "AlterarContaReceber",
    inputSchema: {
      type: "object",
      properties: { codigo_lancamento_omie: titleKey.codigo_lancamento_omie, ...titleFields },
    },
  },
  {
    name: "receive_account_receivable",
    description:
      "Settle / record a receipt (baixa) against an AR title in Omie ERP (LancarRecebimento). Identify " +
      "the title with codigo_lancamento or codigo_lancamento_integracao — without one of them the " +
      "settlement has no target.",
    path: AR,
    call: "LancarRecebimento",
    inputSchema: {
      type: "object",
      properties: settlementFields("receipt"),
      required: ["valor", "data", "codigo_conta_corrente"],
    },
  },
  {
    name: "cancel_receipt",
    description: "Cancel a receipt previously settled on an AR title in Omie ERP (CancelarRecebimento)",
    path: AR,
    call: "CancelarRecebimento",
    inputSchema: {
      type: "object",
      properties: { codigo_baixa: { type: "number", description: "Omie settlement ID to cancel" } },
      required: ["codigo_baixa"],
    },
  },

  // --- Accounts payable ------------------------------------------------------
  {
    name: "create_account_payable",
    description: "Create an accounts payable (AP) entry in Omie ERP",
    path: AP,
    call: "IncluirContaPagar",
    inputSchema: {
      type: "object",
      properties: {
        codigo_lancamento_integracao: { type: "string", description: "Integration code (unique)" },
        codigo_cliente_fornecedor: { type: "number", description: "Omie supplier ID" },
        data_vencimento: date("Due date"),
        valor_documento: { type: "number", description: "Document value in BRL" },
        codigo_categoria: { type: "string", description: "Category code (chart of accounts)" },
        data_previsao: date("Expected payment date"),
        id_conta_corrente: { type: "number", description: "Bank account ID" },
        numero_documento: { type: "string", description: "Document/invoice number" },
        observacao: { type: "string", description: "Notes" },
      },
      required: ["codigo_lancamento_integracao", "codigo_cliente_fornecedor", "data_vencimento", "valor_documento", "codigo_categoria"],
    },
  },
  {
    name: "list_accounts_payable",
    description: "List accounts payable (AP) titles in Omie ERP",
    path: AP,
    call: "ListarContasPagar",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        dDtVencDe: date("Due date from"),
        dDtVencAte: date("Due date to"),
        status_titulo: { type: "string", description: "Title status (ABERTO, LIQUIDADO, etc.)" },
      },
    },
    param: withPaging("snake"),
  },
  {
    name: "get_account_payable",
    description: "Consult a single accounts payable title in Omie ERP",
    path: AP,
    call: "ConsultarContaPagar",
    inputSchema: { type: "object", properties: titleKey },
  },
  {
    name: "update_account_payable",
    description: "Update an accounts payable title in Omie ERP (AlterarContaPagar)",
    path: AP,
    call: "AlterarContaPagar",
    inputSchema: {
      type: "object",
      properties: { codigo_lancamento_omie: titleKey.codigo_lancamento_omie, ...titleFields },
    },
  },
  {
    name: "pay_account_payable",
    description: "Settle / record payment (baixa) for an AP title in Omie ERP",
    path: AP,
    call: "LancarPagamento",
    inputSchema: {
      type: "object",
      properties: {
        codigo_lancamento: { type: "number", description: "Omie AP title ID" },
        codigo_lancamento_integracao: { type: "string", description: "Integration code (alternative to codigo_lancamento)" },
        codigo_baixa: { type: "string", description: "Settlement integration code (unique)" },
        valor: { type: "number", description: "Paid amount in BRL" },
        data: date("Payment date"),
        codigo_conta_corrente: { type: "number", description: "Bank account ID used for the payment" },
        observacao: { type: "string", description: "Payment notes" },
      },
      required: ["codigo_baixa", "valor", "data", "codigo_conta_corrente"],
    },
  },
  {
    name: "cancel_payment",
    description: "Cancel a payment previously settled on an AP title in Omie ERP (CancelarPagamento)",
    path: AP,
    call: "CancelarPagamento",
    inputSchema: {
      type: "object",
      properties: { codigo_baixa: { type: "number", description: "Omie settlement ID to cancel" } },
      required: ["codigo_baixa"],
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
            nCodCC: { type: "number", description: "Bank account ID (get_bank_accounts)" },
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
            nCodCliente: { type: "number", description: "Customer / payee ID" },
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
  },
  {
    name: "list_cash_entries",
    description: "List bank account ledger entries in Omie ERP (ListarLancCC)",
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
        cOrigem: { type: "string", description: "Entry origin code, 4 chars (e.g. DEVP for a sales-return payable)" },
      },
    },
    param: withPaging("n"),
  },
  {
    name: "update_cash_entry",
    description: "Update a bank account ledger entry in Omie ERP (AlterarLancCC)",
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
    },
  },
  {
    name: "delete_cash_entry",
    description: "Delete a bank account ledger entry in Omie ERP (ExcluirLancCC)",
    path: CC,
    call: "ExcluirLancCC",
    inputSchema: {
      type: "object",
      properties: {
        nCodLanc: { type: "number", description: "Omie entry ID" },
        cCodIntLanc: { type: "string", description: "Integration code (alternative)" },
      },
    },
  },

  // --- Cross-cutting views ---------------------------------------------------
  {
    name: "list_financial_movements",
    description: "List unified financial movements (AP + AR + CC) in Omie ERP",
    path: "/financas/mf/",
    call: "ListarMovimentos",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("n"),
        dDtPagtoDe: date("Payment date from"),
        dDtPagtoAte: date("Payment date to"),
        cNatureza: { type: "string", enum: ["R", "P", "T"], description: "Nature (R=receivable, P=payable, T=all)" },
        cStatus: { type: "string", description: "Status (ABERTO, LIQUIDADO, VENCIDO, etc.)" },
      },
    },
    param: withPaging("n"),
  },
  {
    name: "get_bank_statement",
    description: "Retrieve bank account statement (extrato) for a period from Omie ERP",
    path: "/financas/extrato/",
    call: "ListarExtrato",
    inputSchema: {
      type: "object",
      properties: {
        nCodCC: { type: "number", description: "Bank account ID" },
        cCodIntCC: { type: "string", description: "Bank account integration code (alternative to nCodCC)" },
        dPeriodoInicial: date("Start date"),
        dPeriodoFinal: date("End date"),
        cExibirApenasSaldo: flag("Show only balances"),
      },
      required: ["dPeriodoInicial", "dPeriodoFinal"],
    },
  },
  {
    name: "get_finance_summary",
    description:
      "Get the consolidated finance position for a day in Omie ERP (ObterResumoFinancas) — balances and " +
      "totals rather than a title-by-title listing. Defaults to today when dDia is omitted.",
    path: "/financas/resumo/",
    call: "ObterResumoFinancas",
    inputSchema: {
      type: "object",
      properties: {
        dDia: date("Reference date; defaults to today"),
        lApenasResumo: { type: "boolean", description: "Return only the summary structures, without the per-entry detail" },
        lExibirCategoria: { type: "boolean", description: "Break the totals down by category" },
      },
    },
  },
  {
    name: "list_open_titles",
    description:
      "List the titles still open on a given day in Omie ERP (ObterListaEmAberto) — the collections and " +
      "payables worklist. cTipo selects P (payables) or R (receivables).",
    path: "/financas/resumo/",
    call: "ObterListaEmAberto",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("n"),
        dDia: date("Reference date; defaults to today"),
        cTipo: { type: "string", enum: ["P", "R"], description: "P=payables, R=receivables" },
        nCodCliente: { type: "number", description: "Filter by customer / supplier ID" },
        cNomeCliente: { type: "string", description: "Filter by customer / supplier name" },
      },
    },
    param: withPaging("n"),
  },
];
