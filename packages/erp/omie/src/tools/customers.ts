import { OmieTool, pagingSchema, withPaging, flag, changeTrackingFilters, ID } from "./types.js";

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

/**
 * What clientesFiltro actually filters on. Production, 2026-09-27, one call per
 * key against a 238-record register: the seven keys below narrowed the result;
 * estado, cidade (name or IBGE code), email (partial or exact), bairro, cep,
 * endereco, inscricao_estadual, inscricao_municipal, pessoa_fisica,
 * optante_simples_nacional and contato all came back with the full 238 —
 * accepted and ignored, so an agent "filtering by state" was handed the whole
 * register.
 */
const CUSTOMER_FILTER =
  "Filter object. Keys that filter: codigo_cliente_omie, codigo_cliente_integracao, cnpj_cpf (with or " +
  "without punctuation), razao_social (matches any part of the name), nome_fantasia, inativo, " +
  "tags (e.g. [{\"tag\": \"Fornecedor\"}]). Omie ignores every other key — estado, cidade, email, " +
  "bairro, cep, endereco, inscrições, pessoa_fisica, optante_simples_nacional, contato — and returns " +
  "the unfiltered register, so filter those on the result instead";

export const customerTools: OmieTool[] = [
  {
    name: "list_customers",
    description:
      "List or search customers (and suppliers — Omie keeps both in one register) in Omie ERP " +
      "(ListarClientes). Returns codigo_cliente_omie, the ID other tools take as codigo_cliente, " +
      "codigo_cliente_fornecedor, nCodCli, nIdCliente or nCodCliente. Search with clientesFiltro, e.g. " +
      "{\"cnpj_cpf\": \"...\"} or {\"razao_social\": \"...\"}, instead of paging — but not by state, city or " +
      "e-mail: Omie ignores those keys and returns everyone.",
    path: PATH,
    call: "ListarClientes",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        clientesFiltro: { type: "object", description: CUSTOMER_FILTER },
      },
    },
    param: withPaging("snake"),
  },
  {
    name: "create_customer",
    description:
      "Create a customer in Omie ERP (IncluirCliente); returns codigo_cliente_omie. Can create a duplicate when " +
      "the CNPJ/CPF is already registered — prefer upsert_customer unless you have just checked with " +
      "list_customers.",
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
    description: "Consult a single customer in Omie ERP (ConsultarCliente) by Omie ID or integration code. To find one by CNPJ/CPF use list_customers with clientesFiltro.cnpj_cpf",
    path: PATH,
    call: "ConsultarCliente",
    inputSchema: {
      type: "object",
      properties: {
        codigo_cliente_omie: { type: "number", description: ID.customer },
        codigo_cliente_integracao: { type: "string", description: "Integration code (alternative)" },
      },
      anyOfRequired: ["codigo_cliente_omie", "codigo_cliente_integracao"],
    },
  },
  {
    name: "update_customer",
    description:
      "Update an existing customer in Omie ERP (AlterarCliente). Identify the record with codigo_cliente_omie or " +
      "codigo_cliente_integracao; only the fields you send are changed.",
    path: PATH,
    call: "AlterarCliente",
    inputSchema: {
      type: "object",
      properties: {
        codigo_cliente_omie: { type: "number", description: ID.customer },
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
      "List or search customers in the reduced form (ListarClientesResumido) — five fields per record " +
      "(codigo_cliente, codigo_cliente_integracao, razao_social, nome_fantasia, cnpj_cpf), so it stays " +
      "within a page budget when scanning a large base. The ID comes back as codigo_cliente here — the same " +
      "value list_customers calls codigo_cliente_omie. Accepts the same clientesFiltro object as list_customers.",
    path: PATH,
    call: "ListarClientesResumido",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        ...changeTrackingFilters(),
        clientesFiltro: { type: "object", description: CUSTOMER_FILTER },
        clientesPorCodigo: {
          type: "array",
          description: "Filter by a list of customers, each given as an object — [5960133379] is refused by Omie",
          items: {
            type: "object",
            properties: {
              codigo_cliente_omie: { type: "number", description: ID.customer },
              codigo_cliente_integracao: { type: "string", description: "Integration code (alternative)" },
            },
            anyOfRequired: ["codigo_cliente_omie", "codigo_cliente_integracao"],
          },
        },
        apenas_importado_api: flag("Only API-created records"),
        exibir_obs: flag(
          "Accepted but has no effect here: the reduced record has no notes field. Read notes with get_customer (observacao)"
        ),
      },
    },
    param: withPaging("snake"),
  },
];
