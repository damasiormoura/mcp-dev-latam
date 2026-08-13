import { OmieTool, listOnly, pagingSchema, withPaging, date, flag } from "./types.js";

const ADJUST = "/estoque/ajuste/";
const QUERY = "/estoque/consulta/";

export const stockTools: OmieTool[] = [
  {
    name: "create_stock_adjustment",
    description:
      "Create an inventory adjustment (entry/exit/balance/transfer) in Omie ERP (IncluirAjusteEstoque). " +
      "This endpoint uses abbreviated field names (id_prod, quan, obs). Identify the product with id_prod " +
      "or cod_int; every other field listed as required below is mandatory on Omie's side.",
    path: ADJUST,
    call: "IncluirAjusteEstoque",
    inputSchema: {
      type: "object",
      properties: {
        id_prod: { type: "number", description: "Omie product ID (from list_products)" },
        cod_int: { type: "string", description: "Product integration code (alternative to id_prod)" },
        cod_int_ajuste: { type: "string", description: "Integration code for this adjustment — send it to keep the operation idempotent" },
        codigo_local_estoque: { type: "number", description: "Warehouse location ID (list_stock_locations); defaults to the standard location" },
        codigo_local_estoque_destino: { type: "number", description: "Destination warehouse — required when tipo is \"TRF\"" },
        data: date("Adjustment date"),
        tipo: {
          type: "string",
          enum: ["ENT", "SAI", "SLD", "TRF"],
          description: "Adjustment type: ENT=stock entry, SAI=stock exit, SLD=set the balance, TRF=transfer between locations",
        },
        origem: { type: "string", enum: ["AJU", "PDV"], description: "Movement origin: AJU=manual adjustment, PDV=point of sale" },
        motivo: {
          type: "string",
          description:
            "Reason code, 3 chars, valid values depend on tipo. ENT: INV, OPE, PDV, INI. SAI: INV, PER, OPS, PDV. " +
            "SLD: INV, INI, CMC, PDV. TRF: TRF, TPQ. (INV=inventory, PER=loss/breakage, INI=opening balance, CMC=cost adjustment)",
        },
        quan: { type: "number", description: "Quantity" },
        valor: { type: "number", description: "Movement unit value in BRL" },
        obs: { type: "string", description: "Notes" },
        lote_validade: {
          type: "array",
          description: "Batch / expiry data — required for products under batch control",
          items: {
            type: "object",
            properties: {
              nIdLote: { type: "number", description: "Batch ID — required for batch-controlled products when tipo is not \"ENT\"" },
              nQtdLote: { type: "number", description: "Quantity for this batch" },
              cNumLote: { type: "string", description: "Batch number — only when tipo is \"ENT\" and nIdLote is absent; creates a new batch" },
              cCodAgreg: { type: "string", description: "Batch aggregation code — only when tipo is \"ENT\" and nIdLote is absent" },
              dDataFab: date("Manufacturing date"),
              dDataVal: date("Expiry date"),
            },
          },
        },
      },
      required: ["data", "tipo", "origem", "motivo", "quan", "valor", "obs"],
      anyOfRequired: ["id_prod", "cod_int"],
    },
  },
  {
    name: "list_stock_adjustments",
    description: "List inventory adjustments in Omie ERP (ListarAjusteEstoque)",
    path: ADJUST,
    call: "ListarAjusteEstoque",
    ...listOnly("n"),
  },
  {
    name: "get_stock_position",
    description: "Get current stock position / balance in Omie ERP",
    path: QUERY,
    call: "ListarPosEstoque",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("n"),
        dDataPosicao: date("Position reference date"),
        cExibeTodos: flag("Include items with zero stock (default N)"),
        codigo_local_estoque: { type: "number", description: "Filter by warehouse location ID (list_stock_locations)" },
        lista_local_estoque: { type: "string", description: "Comma-separated list of warehouse location IDs" },
        cTipoItem: { type: "string", description: "Item type code, 2 chars (from the product's fiscal tab)" },
      },
    },
    param: withPaging("n"),
  },
  {
    name: "get_product_stock",
    description:
      "Get the stock position of a single product in Omie ERP (PosicaoEstoque) — cheaper than paging " +
      "get_stock_position when you already know the product.",
    path: QUERY,
    call: "PosicaoEstoque",
    inputSchema: {
      type: "object",
      properties: {
        id_prod: { type: "number", description: "Omie product ID" },
        cod_int: { type: "string", description: "Product integration code (alternative)" },
        codigo_local_estoque: { type: "number", description: "Warehouse location ID" },
        data: date("Reference date"),
      },
      anyOfRequired: ["id_prod", "cod_int"],
    },
  },
  {
    name: "list_stock_movements",
    description:
      "List stock movements over a period in Omie ERP (ListarMovimentoEstoque) — the ledger behind the " +
      "balances that get_stock_position reports.",
    path: QUERY,
    call: "ListarMovimentoEstoque",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("n"),
        codigo_local_estoque: { type: "number", description: "Filter by warehouse location ID" },
        idProd: { type: "number", description: "Filter by Omie product ID" },
        dDtInicial: date("Start date"),
        dDtFinal: date("End date"),
        lista_local_estoque: { type: "string", description: "Comma-separated list of warehouse location IDs" },
      },
    },
    param: withPaging("n"),
  },
  {
    name: "list_stock_locations",
    description:
      "List the warehouse locations configured in Omie ERP (ListarLocaisEstoque). Resolves the " +
      "codigo_local_estoque that create_stock_adjustment, get_stock_position and sales order items expect.",
    path: "/estoque/local/",
    call: "ListarLocaisEstoque",
    ...listOnly("n"),
  },
];
