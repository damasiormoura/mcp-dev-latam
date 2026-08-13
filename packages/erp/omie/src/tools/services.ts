import { OmieTool, listOnly, pagingSchema, withPaging, date, flag } from "./types.js";

const OS = "/servicos/os/";
const OSP = "/servicos/osp/";

/** Identifies a service order across both the OS and OS-billing endpoints. */
const osKey = {
  nCodOS: { type: "number", description: "Omie service order ID" },
  cCodIntOS: { type: "string", description: "Service order integration code (alternative)" },
} as const;
const osKeyRequired = ["nCodOS", "cCodIntOS"] as const;

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
  nCodCli: { type: "number", description: "Omie customer ID (from list_customers)" },
  cCodIntCli: { type: "string", description: "Customer integration code (alternative to nCodCli)" },
  cNumOS: { type: "string", description: "OS number shown to the customer; generated when omitted" },
  dDtPrevisao: date("Expected date"),
  cEtapa: { type: "string", description: "Stage code: 10, 20, 30, 40, 50=Faturar, 60=Faturado" },
  cCodParc: { type: "string", description: "Payment term code, e.g. \"999\" for a single installment" },
  nQtdeParc: { type: "number", description: "Number of installments" },
  nCodVend: { type: "number", description: "Salesperson ID" },
  nCodCtr: { type: "number", description: "Contract ID — attaches this OS to an existing contract" },
} as const;

const osInfo = {
  cCodCateg: { type: "string", description: "Category code from the chart of accounts (list_categories)" },
  nCodCC: { type: "number", description: "Bank account ID (get_bank_accounts)" },
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
      "Cabecalho + ServicosPrestados[] + InformacoesAdicionais.",
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
  },
  {
    name: "list_service_orders",
    description:
      "List service orders (OS) from Omie ERP. Note the stage filter is `filtrar_por_etapa` here, not " +
      "`etapa` as on the sales order endpoint.",
    path: OS,
    call: "ListarOS",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        filtrar_por_etapa: { type: "string", description: "Stage filter (10=OS, 20=Executar, 50=Faturar, 60=Faturado)" },
        filtrar_por_status: { type: "string", enum: ["F", "N", "C"], description: "Status: F=billed, N=not billed, C=cancelled" },
        filtrar_por_cliente: { type: "number", description: "Filter by customer ID" },
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
    description: "Consult a specific service order in Omie ERP (ConsultarOS)",
    path: OS,
    call: "ConsultarOS",
    inputSchema: {
      type: "object",
      properties: { ...osKey, cNumOS: { type: "string", description: "OS number as shown to the customer (alternative)" } },
      anyOfRequired: [...osKeyRequired, "cNumOS"],
    },
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
  },
  {
    name: "change_service_order_stage",
    description: "Move a service order to another stage in Omie ERP (TrocarEtapaOS)",
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
      "Bill a service order in Omie ERP (FaturarOS), issuing the NFS-e — the service-side counterpart " +
      "of invoice_sales_order.",
    path: OSP,
    call: "FaturarOS",
    inputSchema: { type: "object", properties: osKey, anyOfRequired: osKeyRequired },
  },
  {
    name: "cancel_service_order",
    description: "Cancel a service order in Omie ERP (CancelarOS)",
    path: OSP,
    call: "CancelarOS",
    inputSchema: { type: "object", properties: osKey, anyOfRequired: osKeyRequired },
  },
  {
    name: "list_services",
    description:
      "List the service catalogue in Omie ERP (ListarCadastroServico). Resolves the nCodServico that " +
      "create_service_order items reference, along with their LC 116 and municipal codes.",
    path: "/servicos/servico/",
    call: "ListarCadastroServico",
    ...listOnly("n"),
  },
  {
    name: "list_nfse",
    description: "List issued service invoices (NFS-e) in Omie ERP (ListarNFSEs)",
    path: "/servicos/nfse/",
    call: "ListarNFSEs",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("n"),
        dEmiInicial: date("Start emission date"),
        dEmiFinal: date("End emission date"),
        nNumeroNFSe: { type: "string", description: "NFS-e number" },
        nCodigoCliente: { type: "number", description: "Filter by customer ID" },
        nCodigoOS: { type: "number", description: "Filter by service order ID" },
        cStatusNFSe: { type: "string", enum: ["C", "F", "N"], description: "Status: C=cancelled, F=billed, N=not billed" },
        cExibirDescricao: flag("Include the service description"),
      },
    },
    param: withPaging("n"),
  },
];
