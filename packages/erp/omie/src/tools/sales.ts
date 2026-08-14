import { OmieTool, listOnly, pagingSchema, withPaging, date, flag, changeTrackingFilters, orderingFilters } from "./types.js";

const ORDER = "/produtos/pedido/";
const FAT = "/produtos/pedidovendafat/";
const NF = "/produtos/nfconsultar/";

/** Identifies a sales order by Omie ID or integration code. */
const orderKey = {
  codigo_pedido: { type: "number", description: "Omie order ID" },
  codigo_pedido_integracao: { type: "string", description: "Integration order code (alternative)" },
} as const;
const orderKeyRequired = ["codigo_pedido", "codigo_pedido_integracao"] as const;

/** The billing endpoint spells the same key differently. */
const fatKey = {
  nCodPed: { type: "number", description: "Omie order ID" },
  cCodIntPed: { type: "string", description: "Integration order code (alternative)" },
} as const;
const fatKeyRequired = ["nCodPed", "cCodIntPed"] as const;

export const salesTools: OmieTool[] = [
  {
    name: "create_order",
    description:
      "Create a sales order in Omie ERP (IncluirPedido). The body mirrors the Omie contract: " +
      "cabecalho + det[] + informacoes_adicionais. Resolve codigo_categoria with list_categories, " +
      "codigo_conta_corrente with get_bank_accounts and codigo_parcela with list_payment_terms before calling.",
    path: ORDER,
    call: "IncluirPedido",
    inputSchema: {
      type: "object",
      properties: {
        cabecalho: {
          type: "object",
          description: "Order header",
          properties: {
            codigo_cliente: { type: "number", description: "Omie customer ID (codigo_cliente_omie from list_customers)" },
            codigo_pedido_integracao: { type: "string", description: "Integration order code (unique, max 60 chars)" },
            data_previsao: date("Expected billing date"),
            etapa: { type: "string", description: "Order stage: 00=Orçamento, 10=Pedido, 20=Separar, 50=Faturar, 60=Faturado" },
            codigo_parcela: { type: "string", description: "Payment term code, e.g. \"999\" for a single installment (list_payment_terms)" },
            qtde_parcelas: { type: "number", description: "Number of installments; required when codigo_parcela is a multi-installment term" },
            codigo_cenario_impostos: { type: "number", description: "Tax scenario ID; the default scenario is used when omitted" },
            origem_pedido: { type: "string", description: "Order origin, 3 chars (default API)" },
            tipo_desconto_pedido: { type: "string", enum: ["V", "P"], description: "Order-level discount type: V=value, P=percent" },
            valor_desconto_pedido: { type: "number", description: "Order-level discount value" },
            perc_desconto_pedido: { type: "number", description: "Order-level discount percent" },
          },
          required: ["codigo_cliente", "codigo_pedido_integracao", "data_previsao", "etapa", "codigo_parcela"],
        },
        det: {
          type: "array",
          description:
            "Order line items. Each entry wraps the product in a `produto` object — the price is " +
            "det[].produto.valor_unitario, not on the item root.",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              ide: {
                type: "object",
                properties: {
                  codigo_item_integracao: { type: "string", description: "Integration code for this line (unique within the order)" },
                  simples_nacional: flag("Company opted into Simples Nacional"),
                },
                required: ["codigo_item_integracao"],
              },
              produto: {
                type: "object",
                description:
                  "Product data. Identify the product with codigo_produto (Omie ID) or " +
                  "codigo_produto_integracao — one of the two is required.",
                properties: {
                  codigo_produto: { type: "number", description: "Omie product ID (from list_products)" },
                  codigo_produto_integracao: { type: "string", description: "Product integration code (alternative to codigo_produto)" },
                  codigo: { type: "string", description: "Product code shown on the order screen" },
                  descricao: { type: "string", description: "Product description" },
                  cfop: { type: "string", description: "CFOP code, e.g. \"5.102\"" },
                  ncm: { type: "string", description: "NCM code (tax classification)" },
                  unidade: { type: "string", description: "Unit of measure (UN, KG, ...)" },
                  quantidade: { type: "number", description: "Quantity" },
                  valor_unitario: { type: "number", description: "Unit price in BRL" },
                  tipo_desconto: { type: "string", enum: ["V", "P"], description: "Item discount type: V=value, P=percent" },
                  valor_desconto: { type: "number", description: "Item discount value" },
                  percentual_desconto: { type: "number", description: "Item discount percent" },
                },
                required: ["quantidade", "valor_unitario"],
                anyOfRequired: ["codigo_produto", "codigo_produto_integracao"],
              },
              inf_adic: {
                type: "object",
                description: "Per-item extras",
                properties: {
                  peso_liquido: { type: "number", description: "Net weight (kg)" },
                  peso_bruto: { type: "number", description: "Gross weight (kg)" },
                  codigo_local_estoque: { type: "number", description: "Warehouse location ID for this item (list_stock_locations)" },
                  dados_adicionais_item: { type: "string", description: "Extra text carried to the invoice" },
                  nao_movimentar_estoque: flag("Skip the stock exit when the NF-e is issued"),
                  nao_gerar_financeiro: flag("Do not create a receivable for this item"),
                },
              },
              observacao: {
                type: "object",
                properties: { obs_item: { type: "string", description: "Item notes (not printed on the invoice)" } },
              },
            },
            required: ["produto"],
          },
        },
        informacoes_adicionais: {
          type: "object",
          description: "Order-level accounting and billing data",
          properties: {
            codigo_categoria: { type: "string", description: "Category code from the chart of accounts (list_categories)" },
            codigo_conta_corrente: { type: "number", description: "Bank account ID (get_bank_accounts)" },
            consumidor_final: flag("Invoice is for a final consumer"),
            enviar_email: flag("Email the boleto on billing"),
            numero_pedido_cliente: { type: "string", description: "Customer's own order number" },
            contato: { type: "string", description: "Contact name" },
            dados_adicionais_nf: { type: "string", description: "Additional invoice text" },
            codVend: { type: "number", description: "Salesperson ID (list_salespeople)" },
            codProj: { type: "number", description: "Project ID" },
          },
          required: ["codigo_categoria", "codigo_conta_corrente"],
        },
        frete: {
          type: "object",
          description: "Shipping details",
          properties: {
            modalidade: { type: "string", description: "Freight mode: 0=CIF (sender), 1=FOB (recipient), 2=third party, 9=no freight" },
            codigo_transportadora: { type: "number", description: "Carrier ID" },
            valor_frete: { type: "number", description: "Freight amount" },
            valor_seguro: { type: "number", description: "Insurance amount" },
            outras_despesas: { type: "number", description: "Other accessory costs" },
            peso_liquido: { type: "number", description: "Net weight (kg)" },
            peso_bruto: { type: "number", description: "Gross weight (kg)" },
            quantidade_volumes: { type: "number", description: "Number of volumes" },
            previsao_entrega: date("Delivery forecast"),
          },
        },
        lista_parcelas: {
          type: "object",
          description: "Manual installment plan; omit to let codigo_parcela drive it",
          properties: {
            parcela: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  numero_parcela: { type: "number", description: "Installment number" },
                  data_vencimento: date("Due date"),
                  valor: { type: "number", description: "Installment amount" },
                  percentual: { type: "number", description: "Percent of the order total" },
                  quantidade_dias: { type: "number", description: "Days until due, counted from data_previsao" },
                },
                required: ["numero_parcela", "data_vencimento", "valor", "percentual"],
              },
            },
          },
        },
        observacoes: {
          type: "object",
          properties: { obs_venda: { type: "string", description: "Order notes (not shown on the invoice)" } },
        },
      },
      required: ["cabecalho", "det", "informacoes_adicionais"],
    },
  },
  {
    name: "list_orders",
    description:
      "List or search sales orders from Omie ERP. Note `etapa` selects the workflow column while " +
      "`status_pedido` selects the fiscal outcome (FATURADO, CANCELADO, ...) — they answer different " +
      "questions and can be combined.",
    path: ORDER,
    call: "ListarPedidos",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        ...changeTrackingFilters(),
        ...orderingFilters("ordenar_por"),
        etapa: { type: "string", description: "Order stage filter (10=Pedido, 20=Separar, 50=Faturar, 60=Faturado)" },
        status_pedido: { type: "string", description: "Order status: FATURADO, CANCELADO, AUTORIZADO, DENEGADO, DEVOLVIDO" },
        filtrar_por_cliente: { type: "number", description: "Filter by customer ID" },
        filtrar_por_vendedor: { type: "number", description: "Filter by salesperson ID" },
        filtrar_por_projeto: { type: "number", description: "Filter by project ID" },
        numero_pedido_de: { type: "number", description: "Order number range, from" },
        numero_pedido_ate: { type: "number", description: "Order number range, to" },
        data_previsao_de: date("Expected billing date from"),
        data_previsao_ate: date("Expected billing date to"),
        data_faturamento_de: date("Billing date from"),
        data_faturamento_ate: date("Billing date to"),
        data_cancelamento_de: date("Cancellation date from"),
        data_cancelamento_ate: date("Cancellation date to"),
        apenas_resumo: flag("Return only the order summary — much smaller payload per record"),
      },
    },
    param: withPaging("snake"),
  },
  {
    name: "get_sales_order",
    description: "Consult a specific sales order by ID or integration code in Omie ERP",
    path: ORDER,
    call: "ConsultarPedido",
    inputSchema: { type: "object", properties: orderKey, anyOfRequired: orderKeyRequired },
  },
  {
    name: "update_sales_order",
    description:
      "Alter an existing sales order in Omie ERP (AlterarPedidoVenda). Line items go in `det`, the same " +
      "block create_order uses — `itens` is a different type belonging to DevolverPedido and is ignored here.",
    path: ORDER,
    call: "AlterarPedidoVenda",
    inputSchema: {
      type: "object",
      properties: {
        cabecalho: {
          type: "object",
          description: "Order header — identifies the order and carries any header changes",
          properties: {
            codigo_pedido: { type: "number", description: "Omie order ID" },
            codigo_pedido_integracao: { type: "string", description: "Integration order code (alternative)" },
            codigo_cliente: { type: "number", description: "Omie customer ID" },
            data_previsao: date("Expected billing date"),
            etapa: { type: "string", description: "Order stage" },
            codigo_parcela: { type: "string", description: "Payment term code" },
            qtde_parcelas: { type: "number", description: "Number of installments" },
          },
          anyOfRequired: orderKeyRequired,
        },
        det: {
          type: "array",
          description: "Updated line items, same shape as create_order.det — { ide, produto, inf_adic }. Set ide.acao_item=\"E\" to remove a line.",
          items: {
            type: "object",
            properties: {
              ide: {
                type: "object",
                properties: {
                  codigo_item_integracao: { type: "string", description: "Integration code for this line" },
                  codigo_item: { type: "number", description: "Omie line ID, for an existing item" },
                  acao_item: { type: "string", enum: ["E"], description: "\"E\" removes the item" },
                },
              },
              produto: {
                type: "object",
                properties: {
                  codigo_produto: { type: "number", description: "Omie product ID" },
                  codigo_produto_integracao: { type: "string", description: "Product integration code (alternative)" },
                  quantidade: { type: "number", description: "Quantity" },
                  valor_unitario: { type: "number", description: "Unit price in BRL" },
                  valor_desconto: { type: "number", description: "Item discount value" },
                },
              },
              inf_adic: { type: "object", description: "Per-item extras, as in create_order" },
            },
          },
        },
        observacoes: {
          type: "object",
          properties: { obs_venda: { type: "string", description: "Order notes" } },
        },
        informacoes_adicionais: { type: "object", description: "Additional info (codigo_categoria, codigo_conta_corrente, codVend, ...)" },
        frete: { type: "object", description: "Shipping details" },
      },
      required: ["cabecalho"],
    },
  },
  {
    name: "get_order_status",
    description:
      "Get the processing status of a sales order in Omie ERP (StatusPedido) — whether it is billed, " +
      "cancelled, denied or still open. Cheaper than get_sales_order when all you need is the state.",
    path: ORDER,
    call: "StatusPedido",
    inputSchema: { type: "object", properties: orderKey, anyOfRequired: orderKeyRequired },
  },
  {
    name: "change_order_stage",
    description:
      "Move a sales order to another stage in Omie ERP (TrocarEtapaPedido) — this is how an order " +
      "advances from Pedido (10) through Separar (20) to Faturar (50).",
    path: ORDER,
    call: "TrocarEtapaPedido",
    inputSchema: {
      type: "object",
      properties: {
        ...orderKey,
        etapa: { type: "string", description: "Target stage: 10=Pedido, 20=Separar, 50=Faturar, 60=Faturado (list_order_stages for the configured set)" },
      },
      required: ["etapa"],
      anyOfRequired: orderKeyRequired,
    },
  },
  {
    name: "simulate_order_taxes",
    description:
      "Simulate the taxes of a sales order in Omie ERP (SimularImpostos) without creating anything. " +
      "Use this to quote a price before committing an order.",
    path: ORDER,
    call: "SimularImpostos",
    inputSchema: {
      type: "object",
      properties: {
        codigo_cliente: { type: "number", description: "Omie customer ID" },
        consumidor_final: flag("Sale is for a final consumer"),
        frete_simul: {
          type: "object",
          properties: {
            valor_frete: { type: "number", description: "Freight amount" },
            valor_seguro: { type: "number", description: "Insurance amount" },
            outras_despesas: { type: "number", description: "Other accessory costs" },
          },
        },
        det_simul: {
          type: "array",
          description: "Items to price",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              codigo_cenario_impostos_item: { type: "number", description: "Tax scenario ID for this item" },
              produto_simul: {
                type: "object",
                properties: {
                  codigo_produto: { type: "number", description: "Omie product ID" },
                  quantidade: { type: "number", description: "Quantity" },
                  valor_unitario: { type: "number", description: "Unit price in BRL" },
                  valor_desconto: { type: "number", description: "Discount value" },
                },
                required: ["codigo_produto", "quantidade", "valor_unitario"],
              },
            },
            required: ["produto_simul"],
          },
        },
      },
      required: ["codigo_cliente", "det_simul"],
    },
  },
  {
    name: "delete_order",
    description: "Delete a sales order in Omie ERP (ExcluirPedido). Only works while the order is not billed.",
    path: ORDER,
    call: "ExcluirPedido",
    inputSchema: { type: "object", properties: orderKey, anyOfRequired: orderKeyRequired },
  },
  {
    name: "return_order",
    description:
      "Register a return against a billed sales order in Omie ERP (DevolverPedido). Omit `itens` to " +
      "return the order in full, or list products with quantities for a partial return.",
    path: ORDER,
    call: "DevolverPedido",
    inputSchema: {
      type: "object",
      properties: {
        ...orderKey,
        itens: {
          type: "array",
          description: "Items to return; omit for a full return",
          items: {
            type: "object",
            properties: {
              codigo_produto: { type: "number", description: "Omie product ID" },
              quantidade: { type: "number", description: "Quantity to return; full item quantity when omitted" },
            },
            required: ["codigo_produto"],
          },
        },
      },
      anyOfRequired: orderKeyRequired,
    },
  },
  {
    name: "validate_order",
    description:
      "Validate a sales order for billing in Omie ERP (ValidarPedidoVenda) without issuing anything. " +
      "Run this before invoice_sales_order — it reports the blocking problems up front instead of " +
      "failing mid-billing.",
    path: FAT,
    call: "ValidarPedidoVenda",
    inputSchema: { type: "object", properties: fatKey, anyOfRequired: fatKeyRequired },
  },
  {
    name: "invoice_sales_order",
    description: "Generate an invoice (NF) from an existing sales order in Omie ERP",
    path: FAT,
    call: "FaturarPedidoVenda",
    inputSchema: { type: "object", properties: fatKey, anyOfRequired: fatKeyRequired },
  },
  {
    name: "cancel_order",
    description: "Cancel a sales order in Omie ERP (CancelarPedidoVenda)",
    path: FAT,
    call: "CancelarPedidoVenda",
    inputSchema: { type: "object", properties: fatKey, anyOfRequired: fatKeyRequired },
  },
  {
    name: "list_order_stages",
    description:
      "List the sales order stages configured for this Omie account (ListarEtapasPedido). Resolves the " +
      "codes that create_order.cabecalho.etapa and change_order_stage expect.",
    path: "/produtos/pedidoetapas/",
    call: "ListarEtapasPedido",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("n"),
        ...orderingFilters("cOrdenarPor", "cOrdemDecrescente"),
        nCodPed: { type: "number", description: "Filter by Omie order ID" },
        cCodIntPed: { type: "string", description: "Filter by order integration code" },
        cEtapa: { type: "string", description: "Filter by stage code" },
        dDtInicial: date("Date range from"),
        dDtFinal: date("Date range to"),
      },
    },
    param: withPaging("n"),
  },
  {
    name: "list_invoices",
    description:
      "List or search invoices (NF) from Omie ERP. Set cApenasResumo=\"S\" when scanning a period — the " +
      "full NF record is large, and the summary carries the key, number and total.",
    path: NF,
    call: "ListarNF",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("snake"),
        ...changeTrackingFilters(),
        ...orderingFilters("ordenar_por", "ordem_decrescente"),
        dEmiInicial: date("Emission date from"),
        dEmiFinal: date("Emission date to"),
        dRegInicial: date("Registration date from"),
        dRegFinal: date("Registration date to"),
        dSaiEntInicial: date("Exit/entry date from"),
        dSaiEntFinal: date("Exit/entry date to"),
        dCanInicial: date("Cancellation date from"),
        dCanFinal: date("Cancellation date to"),
        filtrar_por_status: { type: "string", enum: ["N", "C"], description: "NF status: N=not cancelled, C=cancelled" },
        tpNF: { type: "string", enum: ["0", "1"], description: "Operation type: 0=inbound, 1=outbound" },
        cSerie: { type: "string", description: "NF-e series" },
        nNFInicial: { type: "number", description: "Invoice number range, from" },
        nNFFinal: { type: "number", description: "Invoice number range, to" },
        nIdCliente: { type: "number", description: "Filter by customer ID" },
        cnpj_cpf: { type: "string", description: "Filter by customer CNPJ / CPF" },
        cNumeroPedidoCliente: { type: "string", description: "Filter by the customer's own order number" },
        opPedido: { type: "string", description: "Originating sales order operation code, 2 chars (e.g. 01=service, 11=product)" },
        cApenasResumo: flag("Return only the NF summary instead of the full record"),
        cDetalhesPedido: flag("Include details of the originating order"),
      },
    },
    param: withPaging("snake"),
  },
  {
    name: "create_invoice",
    description:
      "Consult a specific NF in Omie ERP (ConsultarNF). Despite the name this reads an invoice, it does " +
      "not issue one — use invoice_sales_order to bill an order. Identify the NF by nCodNF, or by " +
      "cChaveNFe, or by nNF + serie.",
    path: NF,
    call: "ConsultarNF",
    inputSchema: {
      type: "object",
      properties: {
        nCodNF: { type: "number", description: "Omie NF ID — the primary key, returned as nIdNF by list_invoices" },
        nNF: { type: "string", description: "Fiscal document number (combine with serie)" },
        serie: { type: "string", description: "Fiscal document series" },
        cChaveNFe: { type: "string", description: "44-digit NF-e access key" },
        nIdPedido: { type: "number", description: "ID of the sales order that generated the NF" },
        cnpj_cpf: { type: "string", description: "Customer CNPJ / CPF" },
        tpNF: { type: "string", enum: ["0", "1"], description: "Operation type: 0=inbound, 1=outbound" },
        cDetalhesPedido: flag("Include details of the originating order"),
      },
    },
  },
  {
    name: "get_invoice_pdf",
    description:
      "Get the download links for an issued NF-e in Omie ERP (ObterNfe) — the DANFE PDF and the XML. " +
      "Takes the NF-e internal ID, which list_invoices returns as nIdNF.",
    path: "/produtos/dfedocs/",
    call: "ObterNfe",
    inputSchema: {
      type: "object",
      properties: {
        nIdNfe: { type: "number", description: "NF-e internal ID (nIdNF from list_invoices / create_invoice)" },
      },
      required: ["nIdNfe"],
    },
  },
];
