import { OmieTool, pagingSchema, withPaging } from "./types.js";

const PIX = "/financas/pix/";
const BOLETO = "/financas/contareceberboleto/";

/** Both boleto and PIX status calls key off an AR title. */
const titleRef = {
  nCodTitulo: { type: "number", description: "Omie accounts receivable title ID" },
  cCodIntTitulo: { type: "string", description: "Title integration code (alternative)" },
} as const;
const titleRefRequired = ["nCodTitulo", "cCodIntTitulo"] as const;

export const billingTools: OmieTool[] = [
  {
    name: "create_pix",
    description:
      "Generate a PIX charge in Omie ERP (GerarPix). Attach it to an existing receivable with " +
      "nCodTitulo, or pass vValor to raise a standalone charge. cUrlNotif receives the payment callback.",
    path: PIX,
    call: "GerarPix",
    inputSchema: {
      type: "object",
      properties: {
        cCodIntPix: { type: "string", description: "Integration code for the PIX (unique) — required by GerarPix" },
        nCodTitulo: { type: "number", description: "AR title to charge; omit to raise a standalone PIX for vValor" },
        vValor: { type: "number", description: "Amount in BRL — required when nCodTitulo is absent" },
        nIdConta: { type: "number", description: "Bank account ID; the account's default is used when omitted" },
        nIdCliente: { type: "number", description: "Customer ID, to identify the payer" },
        cCnpjCpf: { type: "string", description: "Payer CNPJ / CPF (alternative to nIdCliente)" },
        cUrlNotif: { type: "string", description: "Callback URL invoked when the payment settles" },
      },
      required: ["cCodIntPix"],
      anyOfRequired: ["nCodTitulo", "vValor"],
    },
  },
  {
    name: "get_pix_qrcode",
    description: "Get the PIX QR code registered for a bank account in Omie ERP (GerarQrCodePix)",
    path: PIX,
    call: "GerarQrCodePix",
    inputSchema: {
      type: "object",
      properties: { nIdConta: { type: "number", description: "Bank account ID" } },
      required: ["nIdConta"],
    },
  },
  {
    name: "get_pix_status",
    description: "Check whether a PIX charge has been paid in Omie ERP (ObterStatusPix)",
    path: PIX,
    call: "ObterStatusPix",
    inputSchema: {
      type: "object",
      properties: {
        nIdPix: { type: "number", description: "Omie PIX ID" },
        cCodIntPix: { type: "string", description: "PIX integration code (alternative)" },
        nCodTitulo: { type: "number", description: "AR title the PIX was raised against (alternative)" },
      },
      anyOfRequired: ["nIdPix", "cCodIntPix", "nCodTitulo"],
    },
  },
  {
    name: "list_pix",
    description: "List PIX charges in Omie ERP (ListarPix)",
    path: PIX,
    call: "ListarPix",
    inputSchema: { type: "object", properties: pagingSchema("n") },
    param: withPaging("n"),
  },
  {
    name: "cancel_pix",
    description: "Cancel a PIX charge in Omie ERP (CancelarPix)",
    path: PIX,
    call: "CancelarPix",
    inputSchema: {
      type: "object",
      properties: {
        nIdPix: { type: "number", description: "Omie PIX ID" },
        cCodIntPix: { type: "string", description: "PIX integration code (alternative)" },
      },
      anyOfRequired: ["nIdPix", "cCodIntPix"],
    },
  },
  {
    name: "generate_boleto",
    description: "Generate a boleto for an accounts receivable title in Omie ERP (GerarBoleto)",
    path: BOLETO,
    call: "GerarBoleto",
    inputSchema: { type: "object", properties: titleRef, anyOfRequired: titleRefRequired },
  },
  {
    name: "get_boleto",
    description:
      "Get the download link for a boleto already generated in Omie ERP (ObterBoleto). Call " +
      "generate_boleto first if the title has none.",
    path: BOLETO,
    call: "ObterBoleto",
    inputSchema: { type: "object", properties: titleRef, anyOfRequired: titleRefRequired },
  },
  {
    name: "cancel_boleto",
    description: "Cancel a boleto in Omie ERP (CancelarBoleto)",
    path: BOLETO,
    call: "CancelarBoleto",
    inputSchema: { type: "object", properties: titleRef, anyOfRequired: titleRefRequired },
  },
];
