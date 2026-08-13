import { OmieTool, pagingSchema, withPaging, flag } from "./types.js";

const PATH = "/geral/produtos/";

/** Writable fields of `produto_servico_cadastro`. */
const productFields = {
  codigo_produto_integracao: { type: "string", description: "Integration code for the product (unique); the key for idempotent writes" },
  codigo: { type: "string", description: "Product code (SKU) — unique within Omie" },
  descricao: { type: "string", description: "Product description" },
  unidade: { type: "string", description: "Unit of measure (UN, KG, ...)" },
  ncm: { type: "string", description: "NCM code (tax classification)" },
  valor_unitario: { type: "number", description: "Unit price in BRL" },
  codigo_familia: { type: "number", description: "Product family ID" },
  ean: { type: "string", description: "EAN / GTIN barcode" },
  peso_liq: { type: "number", description: "Net weight (kg)" },
  peso_bruto: { type: "number", description: "Gross weight (kg)" },
  descr_detalhada: { type: "string", description: "Detailed description" },
  obs_internas: { type: "string", description: "Internal notes" },
  inativo: flag("Product is inactive"),
} as const;

export const productTools: OmieTool[] = [
  {
    name: "list_products",
    description: "List products from Omie ERP",
    path: PATH,
    call: "ListarProdutos",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        apenas_importado_api: flag("Only API-imported products"),
        filtrar_apenas_omiepdv: flag("Only products flagged for Omie PDV"),
      },
    },
    param: withPaging("snake"),
  },
  {
    name: "create_product",
    description: "Create a product in Omie ERP",
    path: PATH,
    call: "IncluirProduto",
    inputSchema: {
      type: "object",
      properties: productFields,
      required: ["descricao", "codigo", "unidade", "ncm", "valor_unitario"],
    },
  },
  {
    name: "get_product",
    description: "Consult a single product in Omie ERP by Omie ID, integration code or SKU",
    path: PATH,
    call: "ConsultarProduto",
    inputSchema: {
      type: "object",
      properties: {
        codigo_produto: { type: "number", description: "Omie product ID" },
        codigo_produto_integracao: { type: "string", description: "Integration code (alternative)" },
        codigo: { type: "string", description: "Product code / SKU (alternative)" },
      },
    },
  },
  {
    name: "update_product",
    description:
      "Update an existing product in Omie ERP. Identify the record with codigo_produto, " +
      "codigo_produto_integracao or codigo; only the fields you send are changed.",
    path: PATH,
    call: "AlterarProduto",
    inputSchema: {
      type: "object",
      properties: {
        codigo_produto: { type: "number", description: "Omie product ID" },
        ...productFields,
      },
    },
  },
  {
    name: "upsert_product",
    description:
      "Create or update a product in Omie ERP keyed on the integration code (UpsertProduto). Preferred " +
      "over create_product when syncing a catalogue that may already be partly loaded.",
    path: PATH,
    call: "UpsertProduto",
    inputSchema: {
      type: "object",
      properties: productFields,
      required: ["codigo_produto_integracao"],
    },
  },
];
