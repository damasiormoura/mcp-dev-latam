import { OmieTool, date } from "./types.js";

const PATH = "/produtos/pedidocompra/";

export const purchaseTools: OmieTool[] = [
  {
    name: "create_purchase_order",
    description:
      "Create a purchase order in Omie ERP (IncluirPedCompra). The body uses the cabecalho_incluir + " +
      "produtos_incluir[] blocks; field names on this endpoint are abbreviated (nCodFor, nQtde, nValUnit).",
    path: PATH,
    call: "IncluirPedCompra",
    inputSchema: {
      type: "object",
      properties: {
        cabecalho_incluir: {
          type: "object",
          description: "Purchase order header. Identify the supplier with nCodFor, cCodIntFor or cCnpjCpfFor.",
          properties: {
            cCodIntPed: { type: "string", description: "Integration code for the purchase order (unique, max 20 chars)" },
            dDtPrevisao: date("Expected delivery date"),
            nCodFor: { type: "number", description: "Omie supplier ID (list_customers also returns suppliers)" },
            cCodIntFor: { type: "string", description: "Supplier integration code (alternative to nCodFor)" },
            cCnpjCpfFor: { type: "string", description: "Supplier CNPJ / CPF (alternative to nCodFor and cCodIntFor)" },
            cCodParc: { type: "string", description: "Payment term code, e.g. \"999\" for a single installment" },
            nQtdeParc: { type: "number", description: "Number of installments" },
            cCodCateg: { type: "string", description: "Purchase category code (list_categories)" },
            nCodCC: { type: "number", description: "Bank account ID (get_bank_accounts)" },
            nCodProj: { type: "number", description: "Project ID" },
            nCodCompr: { type: "number", description: "Buyer ID" },
            cContato: { type: "string", description: "Contact at the supplier" },
            cContrato: { type: "string", description: "Purchase contract number" },
            cNumPedido: { type: "string", description: "Order number sent to the supplier" },
            cObs: { type: "string", description: "Notes printed on the order sent to the supplier" },
            cObsInt: { type: "string", description: "Internal notes, not sent to the supplier" },
            cEmailAprovador: { type: "string", description: "Email of the user who approves the order" },
          },
          required: ["cCodIntPed", "dDtPrevisao"],
          anyOfRequired: ["nCodFor", "cCodIntFor", "cCnpjCpfFor"],
        },
        produtos_incluir: {
          type: "array",
          description: "Purchase order items. Identify each product with nCodProd or cCodIntProd.",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              cCodIntItem: { type: "string", description: "Integration code for this line" },
              nCodProd: { type: "number", description: "Omie product ID (from list_products)" },
              cCodIntProd: { type: "string", description: "Product integration code (alternative to nCodProd)" },
              cProduto: { type: "string", description: "Product code as it appears on the supplier's invoice" },
              cDescricao: { type: "string", description: "Item description" },
              cNCM: { type: "string", description: "NCM code" },
              cUnidade: { type: "string", description: "Unit of measure" },
              cEAN: { type: "string", description: "EAN / GTIN" },
              nQtde: { type: "number", description: "Quantity" },
              nValUnit: { type: "number", description: "Unit price in BRL" },
              nDesconto: { type: "number", description: "Discount value" },
              nPesoLiq: { type: "number", description: "Net weight (kg)" },
              nPesoBruto: { type: "number", description: "Gross weight (kg)" },
              codigo_local_estoque: { type: "number", description: "Warehouse location ID; defaults to the standard location" },
              cCodCateg: { type: "string", description: "Per-item purchase category code" },
              cObs: { type: "string", description: "Item notes, printed on the order" },
            },
            required: ["nQtde", "nValUnit"],
            anyOfRequired: ["nCodProd", "cCodIntProd"],
          },
        },
        frete_incluir: {
          type: "object",
          description: "Freight, transport and accessory costs",
          properties: {
            nCodTransp: { type: "number", description: "Carrier ID" },
            cCodIntTransp: { type: "string", description: "Carrier integration code" },
            cTpFrete: { type: "string", description: "Freight mode: 0=CIF, 1=FOB, 2=third party, 9=no freight" },
            nValFrete: { type: "number", description: "Freight amount" },
            nValSeguro: { type: "number", description: "Insurance amount" },
            nValOutras: { type: "number", description: "Other accessory costs" },
            nQtdVol: { type: "number", description: "Number of volumes" },
            nPesoLiq: { type: "number", description: "Net weight (kg)" },
            nPesoBruto: { type: "number", description: "Gross weight (kg)" },
            cPlaca: { type: "string", description: "Vehicle plate" },
            cUF: { type: "string", description: "Plate state (UF)" },
          },
        },
        departamentos_incluir: {
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
        parcelas_incluir: {
          type: "array",
          description: "Manual installment plan; omit to let cCodParc drive it",
          items: {
            type: "object",
            properties: {
              nParcela: { type: "number", description: "Installment number" },
              dVencto: date("Due date"),
              nValor: { type: "number", description: "Installment amount" },
              nPercent: { type: "number", description: "Percent of the order total" },
              nDias: { type: "number", description: "Days until due, counted from dDtPrevisao" },
              cTipoDoc: { type: "string", description: "Document type (see /geral/tiposdoc/)" },
            },
          },
        },
      },
      required: ["cabecalho_incluir", "produtos_incluir"],
    },
  },
  {
    name: "list_purchase_orders",
    description:
      "List purchase orders from Omie ERP (PesquisarPedCompra). This endpoint has no `etapa` filter and " +
      "its own pagination field names — the stage is selected with the lExibirPedidos* flags, which take \"T\"/\"F\".",
    path: PATH,
    call: "PesquisarPedCompra",
    inputSchema: {
      type: "object",
      properties: {
        nPagina: { type: "number", description: "Page number (default 1)" },
        nRegsPorPagina: { type: "number", maximum: 100, description: "Records per page (default 50, max 100)" },
        dDataInicial: date("Orders from this date"),
        dDataFinal: date("Orders up to this date"),
        lApenasImportadoApi: { type: "string", enum: ["T", "F"], description: "Only orders imported through this API" },
        lApenasAlterados: { type: "boolean", description: "Only orders changed within the period" },
        lExibirPedidosPendentes: { type: "string", enum: ["T", "F"], description: "Include pending orders" },
        lExibirPedidosFaturados: { type: "string", enum: ["T", "F"], description: "Include orders invoiced by the supplier" },
        lExibirPedidosRecebidos: { type: "string", enum: ["T", "F"], description: "Include received orders" },
        lExibirPedidosCancelados: { type: "string", enum: ["T", "F"], description: "Include cancelled orders" },
        lExibirPedidosEncerrados: { type: "string", enum: ["T", "F"], description: "Include closed orders" },
        lExibirPedidosRecParciais: { type: "string", enum: ["T", "F"], description: "Include partially received orders" },
        lExibirPedidosFatParciais: { type: "string", enum: ["T", "F"], description: "Include partially invoiced orders" },
      },
    },
    param: (args) => ({ ...args, nPagina: args.nPagina ?? 1, nRegsPorPagina: args.nRegsPorPagina ?? 50 }),
  },
  {
    name: "get_purchase_order",
    description: "Consult a specific purchase order in Omie ERP (ConsultarPedCompra)",
    path: PATH,
    call: "ConsultarPedCompra",
    inputSchema: {
      type: "object",
      properties: {
        nCodPed: { type: "number", description: "Omie purchase order ID" },
        cCodIntPed: { type: "string", description: "Integration code (alternative)" },
        cNumero: { type: "string", description: "Purchase order number (alternative)" },
      },
      anyOfRequired: ["nCodPed", "cCodIntPed", "cNumero"],
    },
  },
];
