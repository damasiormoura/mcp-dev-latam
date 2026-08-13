import { OmieTool, listOnly, pagingSchema, withPaging, flag } from "./types.js";

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
    description: "List registered bank accounts in Omie ERP",
    path: "/geral/contacorrente/",
    call: "ListarContasCorrentes",
    ...listOnly("snake"),
  },
  {
    name: "list_categories",
    description: "List chart of accounts categories in Omie ERP",
    path: "/geral/categorias/",
    call: "ListarCategorias",
    ...listOnly("snake"),
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
    description: "List projects in Omie ERP",
    path: "/geral/projetos/",
    call: "ListarProjetos",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
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
    ...listOnly("snake"),
  },
  {
    name: "list_salespeople",
    description: "List salespeople registered in Omie ERP (ListarVendedores)",
    path: "/geral/vendedores/",
    call: "ListarVendedores",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        apenas_importado_api: flag("Only API-imported salespeople"),
      },
    },
    param: withPaging("snake"),
  },
];
