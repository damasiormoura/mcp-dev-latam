import { OmieTool, pagingSchema, withPaging, flag, changeTrackingFilters } from "./types.js";

const PATH = "/geral/clientes/";

/**
 * The writable fields of `clientes_cadastro`, shared by IncluirCliente,
 * AlterarCliente and the upserts. Omie splits the phone into DDD + number, and
 * treats most address fields as optional until you issue an NF-e — at which
 * point they become mandatory, which is why they are described that way.
 */
const customerFields = {
  codigo_cliente_integracao: { type: "string", description: "Integration code for the customer (unique); the key for idempotent writes" },
  cnpj_cpf: { type: "string", description: "CNPJ or CPF. Required to issue NF-e / NFS-e" },
  razao_social: { type: "string", description: "Legal name" },
  nome_fantasia: { type: "string", description: "Trade name. Required to issue NF-e / NFS-e" },
  email: { type: "string", description: "Email address" },
  telefone1_ddd: { type: "string", description: "Phone area code (DDD) — Omie stores it separately from the number" },
  telefone1_numero: { type: "string", description: "Phone number, without the area code" },
  endereco: { type: "string", description: "Street address" },
  endereco_numero: { type: "string", description: "Address number" },
  complemento: { type: "string", description: "Address complement" },
  bairro: { type: "string", description: "Neighborhood" },
  cidade: { type: "string", description: "City — accepts the IBGE code or the city name" },
  estado: { type: "string", description: "State (UF), 2 letters" },
  cep: { type: "string", description: "Postal code" },
  inscricao_estadual: { type: "string", description: "State tax registration" },
  inscricao_municipal: { type: "string", description: "Municipal tax registration" },
  optante_simples_nacional: flag("Opted into Simples Nacional"),
  inativo: flag("Customer is inactive"),
} as const;

export const customerTools: OmieTool[] = [
  {
    name: "list_customers",
    description: "List customers from Omie ERP",
    path: PATH,
    call: "ListarClientes",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        clientesFiltro: { type: "object", description: "Filter object (nome_fantasia, cnpj_cpf, etc.)" },
      },
    },
    param: withPaging("snake"),
  },
  {
    name: "create_customer",
    description: "Create a customer in Omie ERP",
    path: PATH,
    call: "IncluirCliente",
    inputSchema: {
      type: "object",
      properties: customerFields,
      required: ["cnpj_cpf", "razao_social"],
    },
  },
  {
    name: "get_customer",
    description: "Consult a single customer in Omie ERP by Omie ID or integration code",
    path: PATH,
    call: "ConsultarCliente",
    inputSchema: {
      type: "object",
      properties: {
        codigo_cliente_omie: { type: "number", description: "Omie customer ID" },
        codigo_cliente_integracao: { type: "string", description: "Integration code (alternative)" },
      },
      anyOfRequired: ["codigo_cliente_omie", "codigo_cliente_integracao"],
    },
  },
  {
    name: "update_customer",
    description:
      "Update an existing customer in Omie ERP. Identify the record with codigo_cliente_omie or " +
      "codigo_cliente_integracao; only the fields you send are changed.",
    path: PATH,
    call: "AlterarCliente",
    inputSchema: {
      type: "object",
      properties: {
        codigo_cliente_omie: { type: "number", description: "Omie customer ID" },
        ...customerFields,
      },
      anyOfRequired: ["codigo_cliente_omie", "codigo_cliente_integracao"],
    },
  },
  {
    name: "upsert_customer",
    description:
      "Create or update a customer in Omie ERP keyed on CNPJ/CPF (UpsertClienteCpfCnpj). Preferred over " +
      "create_customer when the customer may already exist — it is what stops an agent from creating duplicates.",
    path: PATH,
    call: "UpsertClienteCpfCnpj",
    inputSchema: {
      type: "object",
      properties: customerFields,
      required: ["cnpj_cpf"],
    },
  },
  {
    name: "list_customers_summary",
    description:
      "List or search customers in the reduced form (ListarClientesResumido) — fewer fields per record " +
      "than list_customers, so it stays within a page budget when scanning a large base. Accepts the " +
      "same clientesFiltro object as list_customers.",
    path: PATH,
    call: "ListarClientesResumido",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        ...changeTrackingFilters(),
        clientesFiltro: { type: "object", description: "Filter object (nome_fantasia, cnpj_cpf, razao_social, etc.)" },
        clientesPorCodigo: { type: "array", description: "Filter by a list of customer codes" },
        apenas_importado_api: flag("Only API-created records"),
        exibir_obs: flag("Include customer notes"),
      },
    },
    param: withPaging("snake"),
  },
];
