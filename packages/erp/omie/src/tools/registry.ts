import { OmieTool, listOnly, pagingSchema, withPaging, flag, changeTrackingFilters, orderingFilters } from "./types.js";

/**
 * Supporting registries: the lookup tables whose codes the write tools demand.
 * `list_payment_terms` in particular is a prerequisite of create_order —
 * `codigo_parcela` is mandatory there and there was no way to discover a valid
 * value before this existed.
 */
export const registryTools: OmieTool[] = [
  {
    name: "get_company_info",
    description: "List companies registered in Omie ERP",
    path: "/geral/empresas/",
    call: "ListarEmpresas",
    ...listOnly("snake"),
  },
  {
    name: "get_bank_accounts",
    description:
      "List or search registered bank accounts in Omie ERP. Pass `filtrar_por_descricao` to resolve an " +
      "account by name rather than paging — most write tools need a codigo_conta_corrente / nCodCC.",
    path: "/geral/contacorrente/",
    call: "ListarContasCorrentes",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        ...changeTrackingFilters(),
        codigo: { type: "number", description: "Filter by the Omie bank account ID" },
        codigo_integracao: { type: "string", description: "Filter by the account's integration code" },
        filtrar_por_descricao: { type: "string", description: "Filter by account description" },
        filtrar_apenas_ativo: flag("Only active accounts"),
      },
    },
    param: withPaging("snake"),
  },
  {
    name: "list_categories",
    description:
      "List or search chart of accounts categories in Omie ERP. Pass `descricao` to find a category by " +
      "name instead of paging the whole chart — the account typically has well over a hundred entries, " +
      "so resolving a codigo_categoria for a sales order or a payable is a search, not a scan.",
    path: "/geral/categorias/",
    call: "ListarCategorias",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        descricao: { type: "string", description: "Filter by category description (max 50 chars)" },
        filtrar_por_tipo: { type: "string", enum: ["R", "D"], description: "Only revenue (R) or expense (D) categories" },
        filtrar_apenas_ativo: flag("Only active categories"),
      },
    },
    param: withPaging("snake"),
  },
  {
    name: "list_departments",
    description: "List departments (cost centers) in Omie ERP",
    path: "/geral/departamentos/",
    call: "ListarDepartamentos",
    ...listOnly("snake"),
  },
  {
    name: "list_projects",
    description: "List or search projects in Omie ERP",
    path: "/geral/projetos/",
    call: "ListarProjetos",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        ...changeTrackingFilters(),
        ...orderingFilters("ordenar_por", "ordem_descrescente"),
        nome_projeto: { type: "string", description: "Filter by project name" },
        apenas_importado_api: flag("Only API-imported projects"),
      },
    },
    param: withPaging("snake"),
  },
  {
    name: "list_dre",
    description: "List DRE (income statement) chart of accounts in Omie ERP",
    path: "/geral/dre/",
    call: "ListarCadastroDRE",
    inputSchema: {
      type: "object",
      properties: {
        apenasContasAtivas: flag("Only active accounts (default S)"),
      },
    },
    param: (args) => ({ apenasContasAtivas: args.apenasContasAtivas ?? "S" }),
  },
  {
    name: "list_payment_terms",
    description:
      "List the payment terms (condições de pagamento / parcelas) configured in Omie ERP " +
      "(ListarParcelas). Resolves the codigo_parcela that create_order, create_service_order and " +
      "create_purchase_order require — \"999\" is the conventional single-installment code.",
    path: "/geral/parcelas/",
    call: "ListarParcelas",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        ...orderingFilters("ordenar_por", "ordem_decrescente"),
        apenas_importado_api: flag("Only API-created terms"),
      },
    },
    param: withPaging("snake"),
  },
  {
    name: "list_salespeople",
    description:
      "List or search salespeople registered in Omie ERP (ListarVendedores). Pass `filtrar_por_nome` " +
      "to resolve the codigo_vendedor that create_order and create_service_order accept.",
    path: "/geral/vendedores/",
    call: "ListarVendedores",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        ...changeTrackingFilters(),
        ...orderingFilters("ordenar_por", "ordem_descrescente"),
        filtrar_por_nome: { type: "string", description: "Filter by salesperson name" },
        filtrar_por_email: { type: "string", description: "Filter by salesperson e-mail" },
      },
    },
    param: withPaging("snake"),
  },
];
