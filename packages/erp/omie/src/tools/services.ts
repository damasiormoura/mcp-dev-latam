import { OmieTool, listOnly, pagingSchema, withPaging, date, flag, orderingFilters, notes, ID, PAYMENT_TERM } from "./types.js";

const OS = "/servicos/os/";
const OSP = "/servicos/osp/";

/** Identifies a service order across both the OS and OS-billing endpoints. */
const osKey = {
  nCodOS: { type: "number", description: ID.serviceOrder },
  cCodIntOS: { type: "string", description: "Service order integration code (alternative)" },
} as const;
const osKeyRequired = ["nCodOS", "cCodIntOS"] as const;

/**
 * StatusOS answers each RPS with xml_distr, the issued NFS-e's distribution
 * XML, inline. It can be large and says nothing the status fields and the city
 * hall's messages do not — the tool is there to diagnose a rejection, and
 * cUrlNfse already links to the note — so it is dropped before the agent sees
 * the result.
 */
function withoutDistributionXml(result: any): any {
  if (!Array.isArray(result?.ListaRpsNfse)) return result;
  return {
    ...result,
    ListaRpsNfse: result.ListaRpsNfse.map(({ xml_distr, ...rps }: Record<string, unknown>) => rps),
  };
}

/** The ServicosPrestados item shape, shared by IncluirOS and AlterarOS. */
const servicoPrestado = {
  type: "object",
  properties: {
    nCodServico: { type: "number", description: "Registered service ID (list_services)" },
    cCodIntServico: { type: "string", description: "Service integration code (alternative to nCodServico)" },
    cDescServ: { type: "string", description: "Service description" },
    cTribServ: { type: "string", description: "Service taxation type, 2 chars (e.g. \"01\")" },
    cCodServMun: { type: "string", description: "Municipal service code / CNAE" },
    cCodServLC116: { type: "string", description: "LC 116 service code, e.g. \"7.07\"" },
    nQtde: { type: "number", description: "Quantity" },
    nValUnit: { type: "number", description: "Unit price in BRL" },
    cTpDesconto: { type: "string", enum: ["P", "V"], description: "Discount type: P=percent, V=value" },
    nValorDesconto: { type: "number", description: "Discount value" },
    cRetemISS: flag("Withhold ISS"),
    cDadosAdicItem: { type: "string", description: "Additional item text" },
    cCodCategItem: { type: "string", description: "Per-item category code" },
    cNaoGerarFinanceiro: flag("Do not create a receivable for this item"),
    nSeqItem: { type: "number", description: "Item sequence — required when altering an existing item" },
    cAcaoItem: { type: "string", enum: ["A", "E"], description: "On update: A=alter (default), E=exclude the item" },
    impostos: {
      type: "object",
      description: "Tax rates and withholdings; Omie calculates the amounts",
      properties: {
        nAliqISS: { type: "number", description: "ISS rate (%)" },
        nAliqPIS: { type: "number", description: "PIS rate (%)" },
        nAliqCOFINS: { type: "number", description: "COFINS rate (%)" },
        nAliqCSLL: { type: "number", description: "CSLL rate (%)" },
        nAliqIRRF: { type: "number", description: "IRRF rate (%)" },
        nAliqINSS: { type: "number", description: "INSS rate (%)" },
        cRetemPIS: flag("Withhold PIS"),
        cRetemCOFINS: flag("Withhold COFINS"),
        cRetemCSLL: flag("Withhold CSLL"),
        cRetemIRRF: flag("Withhold IRRF"),
        cRetemINSS: flag("Withhold INSS"),
      },
    },
  },
  required: ["nQtde", "nValUnit"],
} as const;

const osHeader = {
  cCodIntOS: { type: "string", description: "Integration code for the OS (unique)" },
  nCodCli: { type: "number", description: ID.customer },
  cCodIntCli: { type: "string", description: "Customer integration code (alternative to nCodCli)" },
  cNumOS: { type: "string", description: "OS number shown to the customer; generated when omitted" },
  dDtPrevisao: date("Expected date"),
  cEtapa: { type: "string", description: "Stage code: 10, 20, 30, 40, 50=Faturar, 60=Faturado" },
  cCodParc: { type: "string", description: PAYMENT_TERM },
  nQtdeParc: { type: "number", description: "Number of installments — required with cCodParc \"999\"" },
  nCodVend: { type: "number", description: "Salesperson ID" },
  nCodCtr: { type: "number", description: "Contract ID — attaches this OS to an existing contract" },
} as const;

const osInfo = {
  cCodCateg: { type: "string", description: "Category code from the chart of accounts (list_categories)" },
  nCodCC: { type: "number", description: ID.bankAccount },
  cCidPrestServ: { type: "string", description: "City where the service was rendered, e.g. \"SAO PAULO (SP)\"" },
  cDadosAdicNF: { type: "string", description: "Additional invoice text" },
  cNumPedido: { type: "string", description: "Customer's own order number" },
  cContato: { type: "string", description: "Contact name" },
  nCodProj: { type: "number", description: "Project ID" },
} as const;

export const serviceTools: OmieTool[] = [
  {
    name: "create_service_order",
    description:
      "Create a service order (OS) in Omie ERP (IncluirOS). This endpoint uses PascalCase blocks: " +
      "Cabecalho + ServicosPrestados[] + InformacoesAdicionais. Returns nCodOS. Nothing fiscal happens " +
      "until invoice_service_order.",
    path: OS,
    call: "IncluirOS",
    inputSchema: {
      type: "object",
      properties: {
        Cabecalho: {
          type: "object",
          description: "Service order header. Identify the customer with nCodCli or cCodIntCli.",
          properties: osHeader,
          required: ["cCodIntOS", "dDtPrevisao", "cEtapa"],
        },
        InformacoesAdicionais: {
          type: "object",
          description: "Accounting and billing data for the OS",
          properties: osInfo,
          required: ["cCodCateg", "nCodCC"],
        },
        ServicosPrestados: {
          type: "array",
          description:
            "Services rendered. Reference a registered service with nCodServico (or cCodIntServico) and " +
            "the tax fields are inherited; otherwise cTribServ, cCodServMun, cCodServLC116 and cDescServ " +
            "are required.",
          minItems: 1,
          items: servicoPrestado,
        },
        Departamentos: {
          type: "array",
          description: "Cost-center split",
          items: {
            type: "object",
            properties: {
              cCodDepto: { type: "string", description: "Department code (list_departments)" },
              nPerc: { type: "number", description: "Percent of the total" },
            },
          },
        },
        Email: {
          type: "object",
          description: "Email delivery options on billing",
          properties: {
            cEnviarPara: { type: "string", description: "Recipient addresses" },
            cEnvBoleto: flag("Send the boleto"),
            cEnvLink: flag("Send the city-hall NFS-e link"),
            cEnvRecibo: flag("Send a receipt instead of the NFS-e"),
          },
        },
        Observacoes: {
          type: "object",
          properties: { cObsOS: { type: "string", description: "OS notes (not shown on the invoice)" } },
        },
      },
      required: ["Cabecalho", "InformacoesAdicionais", "ServicosPrestados"],
    },
    notes: notes("always", "Observacoes", "cObsOS"),
  },
  {
    name: "list_service_orders",
    description:
      "List service orders (OS) from Omie ERP (ListarOS). Returns nCodOS per order. Note the stage filter " +
      "is `filtrar_por_etapa` here, not `etapa` as on the sales order endpoint.",
    path: OS,
    call: "ListarOS",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        filtrar_por_etapa: { type: "string", description: "Stage filter (10=OS, 20=Executar, 50=Faturar, 60=Faturado)" },
        filtrar_por_status: { type: "string", enum: ["F", "N", "C"], description: "Status: F=billed, N=not billed, C=cancelled" },
        filtrar_por_cliente: { type: "number", description: `Filter by ${ID.customer}` },
        filtrar_por_data_de: date("Inclusion / change date from"),
        filtrar_por_data_ate: date("Inclusion / change date to"),
        filtrar_por_data_previsao_de: date("Expected date from"),
        filtrar_por_data_previsao_ate: date("Expected date to"),
        filtrar_por_data_faturamento_de: date("Billing date from"),
        filtrar_por_data_faturamento_ate: date("Billing date to"),
        cExibirProdutos: flag("Include the products used"),
        cExibirDespesas: flag("Include reimbursable expenses"),
      },
    },
    param: withPaging("snake"),
  },
  {
    name: "get_service_order",
    description:
      "Consult a specific service order in Omie ERP (ConsultarOS) by nCodOS, integration code or the OS " +
      "number shown to the customer. It says nothing about the NFS-e at the city hall — whether the RPS " +
      "was accepted, or why it was rejected, is get_service_order_status.",
    path: OS,
    call: "ConsultarOS",
    inputSchema: {
      type: "object",
      properties: { ...osKey, cNumOS: { type: "string", description: "OS number as shown to the customer (alternative)" } },
      anyOfRequired: [...osKeyRequired, "cNumOS"],
    },
  },
  // Production, 2026-10-02: three billed OS had their RPS rejected by the city
  // hall (cStatusRps "003"), and no tool here could say why — list_nfse and
  // get_service_order carry no message. StatusOS, called by hand, returned the
  // city hall's errors (EM076, E0314, EM062). With lMsg=true each send attempt
  // came back as its own block, newest first: informative lines with an empty
  // cSituacao ("Enviando o RPS 17 no Lote ...", "Envio do RPS 17 retornou
  // erros.") around the ERRO lines, so an RPS sent five times showed five.
  // Run through this tool on 2026-10-03 (READ-TOOLS-LIVE.md): without lMsg the
  // same OS returned its 14 ERRO lines in the reverse order, oldest first, with
  // no date — nothing tells the latest attempt's errors from the earlier ones.
  {
    name: "get_service_order_status",
    description:
      "Get the city-hall status of a service order's RPS / NFS-e in Omie ERP (StatusOS), with the city " +
      "hall's own messages — the only read that says why an RPS was rejected: list_nfse and " +
      "get_service_order carry no message. Identify the OS by nCodOS (list_service_orders; returned as " +
      "OrdemServico.nCodigoOS by list_nfse) or cCodIntOS. ListaRpsNfse has one entry per RPS; its " +
      "cStatusLote / cStatusRps are \"001\" waiting to be sent, \"002\" sent and awaiting processing, " +
      "\"003\" processed with error, \"004\" processed (nNfse and cCodVerif filled), \"005\" cancelled. " +
      "mensagens[] carries cCodigo, cDescricao and cCorrecao as the city hall sent them. Without lMsg only " +
      "the error messages come back, OLDEST first and with no date: every send attempt's errors run " +
      "together and nothing says which are the latest. lMsg=true returns the whole exchange, newest " +
      "first, with cSituacao (ERRO / ALERTA / SUCESSO, empty on informative lines), dData and hHora — one " +
      "block per send attempt, each ending in \"Enviando o RPS ... para a prefeitura\" — so the first " +
      "block holds the latest attempt's errors; use it when the RPS was resent. xml_distr, the NFS-e's XML " +
      "inline, is left out of the result; cUrlNfse (and danfe, the same link) opens the note. This only " +
      "reads: it does not resend the RPS — that is ReenviarOS on /servicos/osp/, a write this server does " +
      "not expose.",
    path: OS,
    call: "StatusOS",
    inputSchema: {
      type: "object",
      properties: {
        ...osKey,
        lMsg: {
          type: "boolean",
          description:
            "true: every message exchanged with the city hall, newest first, one block per send attempt, with " +
            "cSituacao, dData and hHora. Absent or false: only the error messages, oldest first and undated, " +
            "so the attempts cannot be told apart",
        },
        lPdfDemo: { type: "boolean", description: "Include cUrlPdfDemo, a pre-signed (expiring) link to the NFS-e statement (demonstrativo) PDF" },
        lPdfDest: { type: "boolean", description: "Include cUrlPdfDest, a pre-signed (expiring) link to the recipient's NFS-e PDF" },
        lRps: { type: "boolean", description: "Include cUrlRps, the link to the RPS — came back empty for an issued Ribeirão Preto NFS-e" },
        lPdfRecibo: { type: "boolean", description: "Include cUrlPdfRecibo, the link to the receipt PDF — empty on an OS with no receipt (cNumRecibo \"0\")" },
      },
      anyOfRequired: osKeyRequired,
    },
    transform: withoutDistributionXml,
  },
  {
    name: "update_service_order",
    description:
      "Alter an existing service order in Omie ERP (AlterarOS). Items carry nSeqItem to identify which " +
      "line is being changed, and cAcaoItem=\"E\" removes one.",
    path: OS,
    call: "AlterarOS",
    inputSchema: {
      type: "object",
      properties: {
        Cabecalho: {
          type: "object",
          description: "Service order header — identifies the OS and carries any header changes",
          properties: { ...osHeader, nCodOS: { type: "number", description: "Omie service order ID" } },
          anyOfRequired: osKeyRequired,
        },
        InformacoesAdicionais: { type: "object", properties: osInfo },
        ServicosPrestados: { type: "array", description: "Items to alter or remove", items: servicoPrestado },
        Observacoes: {
          type: "object",
          properties: { cObsOS: { type: "string", description: "OS notes" } },
        },
      },
      required: ["Cabecalho"],
    },
    // if-present: AlterarOS replaces the notes it is sent.
    notes: notes("if-present", "Observacoes", "cObsOS"),
  },
  {
    name: "change_service_order_stage",
    description:
      "Move a service order to another stage in Omie ERP (TrocarEtapaOS). Changing the stage does not " +
      "bill the OS — use invoice_service_order for that.",
    path: OS,
    call: "TrocarEtapaOS",
    inputSchema: {
      type: "object",
      properties: {
        ...osKey,
        cNumOS: { type: "string", description: "OS number as shown to the customer (alternative)" },
        cEtapa: { type: "string", description: "Target stage code (10, 20, 30, 40, 50, 60)" },
      },
      required: ["cEtapa"],
      anyOfRequired: [...osKeyRequired, "cNumOS"],
    },
  },
  {
    name: "validate_service_order",
    description:
      "Validate a service order for billing in Omie ERP (ValidarOS) without issuing anything. Run this " +
      "before invoice_service_order to surface blocking problems up front.",
    path: OSP,
    call: "ValidarOS",
    inputSchema: { type: "object", properties: osKey, anyOfRequired: osKeyRequired },
  },
  {
    name: "invoice_service_order",
    description:
      "Bill a service order in Omie ERP (FaturarOS): issues the NFS-e at the city hall and creates the AR " +
      "title(s) — a fiscal act, confirm with the person first and run validate_service_order before. The " +
      "undo is cancel_service_order with cCancelarNfse=\"S\". The service-side counterpart of " +
      "invoice_sales_order. The city hall processes the RPS afterwards, so a FaturarOS that succeeds does not " +
      "mean the NFS-e was issued: get_service_order_status says whether it was (cStatusRps \"004\") or why " +
      "the city hall rejected it.",
    path: OSP,
    call: "FaturarOS",
    inputSchema: { type: "object", properties: osKey, anyOfRequired: osKeyRequired },
  },
  {
    name: "cancel_service_order",
    description:
      "Cancel a service order in Omie ERP (CancelarOS). On a billed OS this can also CANCEL ITS NFS-e at the " +
      "city hall — a fiscal, irreversible act, and Omie's own default when the flag is absent. So " +
      "cCancelarNfse is required here: \"S\" cancels the NFS-e too, \"N\" keeps it. Confirm with the person first.",
    path: OSP,
    call: "CancelarOS",
    inputSchema: {
      type: "object",
      properties: {
        ...osKey,
        cCancelarNfse: flag("Also cancel the OS's NFS-e at the city hall (S) or keep it (N) — required, no default"),
      },
      required: ["cCancelarNfse"],
      anyOfRequired: osKeyRequired,
    },
  },
  {
    name: "list_services",
    description:
      "List or search the service catalogue in Omie ERP (ListarCadastroServico). Resolves the " +
      "nCodServico that create_service_order items reference — returned here as intListar.nCodServ — along " +
      "with their LC 116 and municipal codes; pass cDescricao or cCodigo to find one rather than paging. " +
      "Results come in code order: in production cOrdenarPor and cOrdemDecrescente changed nothing.",
    path: "/servicos/servico/",
    call: "ListarCadastroServico",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("n"),
        ...orderingFilters("cOrdenarPor", "cOrdemDecrescente"),
        cDescricao: {
          type: "string",
          description: "Filter by the service's short description — matches the start (\"VISITA\"); use % for anywhere (\"%TÉCNICA%\")",
        },
        cCodigo: { type: "string", description: "Filter by service code" },
        inativo: flag("Filter by inactive status"),
        dInclusaoInicial: date("Created from"),
        dInclusaoFinal: date("Created to"),
        dAlteracaoInicial: date("Changed from"),
        dAlteracaoFinal: date("Changed to"),
      },
    },
    param: withPaging("n"),
  },
  {
    name: "list_nfse",
    description:
      "List issued service invoices (NFS-e) in Omie ERP (ListarNFSEs). It carries no city-hall message: " +
      "for why an RPS was rejected use get_service_order_status with the row's OrdemServico.nCodigoOS. " +
      "Rows can also come back with cStatusNFSe \"R\", which Omie's documentation does not list (only C, " +
      "F and N): seen in production on 2026-10-02 on service orders whose RPS the city hall had rejected.",
    path: "/servicos/nfse/",
    call: "ListarNFSEs",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("n"),
        dEmiInicial: date("Start emission date"),
        dEmiFinal: date("End emission date"),
        nNumeroNFSe: { type: "string", description: "NFS-e number" },
        nCodigoCliente: { type: "number", description: `Filter by ${ID.customer}` },
        nCodigoOS: { type: "number", description: `Filter by ${ID.serviceOrder}` },
        cStatusNFSe: { type: "string", enum: ["C", "F", "N"], description: "Status: C=cancelled, F=billed, N=not billed" },
        cExibirDescricao: flag("Include the service description"),
      },
    },
    param: withPaging("n"),
  },
];
