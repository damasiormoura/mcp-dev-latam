import { OmieTool, pagingSchema, withPaging, date, ID } from "./types.js";

const PIX = "/financas/pix/";
const BOLETO = "/financas/contareceberboleto/";

/** Both boleto and PIX status calls key off an AR title. */
const titleRef = {
  nCodTitulo: { type: "number", description: ID.arTitle },
  cCodIntTitulo: { type: "string", description: "Title integration code — codigo_lancamento_integracao (alternative)" },
} as const;
const titleRefRequired = ["nCodTitulo", "cCodIntTitulo"] as const;

/** Omie prints this on every boleto method; it is the part an agent needs to weigh. */
const BANK_FEES = "A boleto already sent to the bank is subject to bank fees for issuing, cancelling and changing the due date.";

export const billingTools: OmieTool[] = [
  {
    name: "create_pix",
    description:
      "Generate a PIX charge in Omie ERP (GerarPix). With nCodTitulo it charges that existing AR title; " +
      "WITHOUT it Omie creates a NEW AR title for vValor (and, with no payer given, assigns it to a default " +
      "consumer customer it creates if needed). Without nIdConta Omie books it to the omie.CASH account, " +
      "not a bank account — pass nIdConta. Undo with cancel_pix.",
    path: PIX,
    call: "GerarPix",
    inputSchema: {
      type: "object",
      properties: {
        cCodIntPix: { type: "string", description: "Integration code for the PIX (unique) — required by GerarPix" },
        nCodTitulo: { type: "number", description: `${ID.arTitle}. Omit only to create a new AR title for this PIX` },
        vValor: { type: "number", description: "Amount in BRL — required by GerarPix" },
        nIdConta: { type: "number", description: `${ID.bankAccount}. Omie uses omie.CASH when omitted` },
        nIdCliente: { type: "number", description: `Payer: ${ID.customer}. Do not send together with nCodTitulo` },
        cCnpjCpf: { type: "string", description: "Payer CNPJ / CPF (alternative to nIdCliente)" },
        cUrlNotif: { type: "string", description: "Callback URL invoked when the payment settles" },
      },
      required: ["cCodIntPix", "vValor"],
    },
  },
  {
    name: "get_pix_qrcode",
    description:
      "Generate the account's STATIC PIX QR code in Omie ERP (GerarQrCodePix) — no amount, not linked to " +
      "any title. Only an Omie.CASH account has one: for any other nIdConta Omie answers cCodStatus \"719\" " +
      "(\"não está associada ao Omie.CASH\") with empty fields. To charge a specific amount or title use create_pix.",
    path: PIX,
    call: "GerarQrCodePix",
    inputSchema: {
      type: "object",
      properties: { nIdConta: { type: "number", description: `${ID.bankAccount}. Omie uses omie.CASH when omitted` } },
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
        nIdPix: { type: "number", description: "Omie PIX ID — nIdPix from create_pix / list_pix" },
        cCodIntPix: { type: "string", description: "PIX integration code (alternative)" },
        nCodTitulo: { type: "number", description: `${ID.arTitle} the PIX was raised against (alternative)` },
      },
      anyOfRequired: ["nIdPix", "cCodIntPix", "nCodTitulo"],
    },
  },
  {
    name: "list_pix",
    description: "List or search PIX charges in Omie ERP (ListarPix). Returns nIdPix and the nCodTitulo each charge belongs to.",
    path: PIX,
    call: "ListarPix",
    inputSchema: {
      type: "object",
      properties: {
        ...pagingSchema("n"),
        cStatus: { type: "string", enum: ["LIQUIDADO", "CANCELADO", "REGISTRADO"], description: "PIX status" },
        dEmissaoDe: date("Issue date from"),
        dEmissaoAte: date("Issue date to"),
      },
    },
    param: withPaging("n"),
  },
  {
    name: "cancel_pix",
    description:
      "Cancel a PIX charge in Omie ERP (CancelarPix). Omie's own default DELETES the AR title that " +
      "generated the PIX (lDel=true); this tool sends lDel=false unless you set it, so the title stays. " +
      "To cancel the title itself use cancel_account_receivable.",
    path: PIX,
    call: "CancelarPix",
    inputSchema: {
      type: "object",
      properties: {
        nIdPix: { type: "number", description: "Omie PIX ID — nIdPix from create_pix / list_pix" },
        cCodIntPix: { type: "string", description: "PIX integration code (alternative)" },
        lDel: {
          type: "boolean",
          description: "Also DELETE the AR title that generated the PIX. Default false here (Omie's own default is true)",
        },
      },
      anyOfRequired: ["nIdPix", "cCodIntPix"],
    },
    // Omie applies lDel=true when the field is absent, so leaving it out is
    // not neutral: it would delete the receivable along with the charge.
    param: (args) => ({ ...args, lDel: args.lDel ?? false }),
  },
  {
    name: "generate_boleto",
    description:
      "Generate and register a boleto for an AR title in Omie ERP (GerarBoleto). " + BANK_FEES + " Check " +
      "first that the title has none (get_account_receivable: boleto.cGerado = \"S\" means it already " +
      "does). Undo with cancel_boleto.",
    path: BOLETO,
    call: "GerarBoleto",
    inputSchema: { type: "object", properties: titleRef, anyOfRequired: titleRefRequired },
  },
  {
    name: "get_boleto",
    description:
      "Get the download link (cLinkBoleto), barcode and number of a boleto already generated in Omie ERP " +
      "(ObterBoleto). A read, although Omie answers \"Boleto gerado com sucesso!\"; a title it cannot find comes " +
      "back as HTTP 200 with cCodStatus \"103\" and empty fields, so check cCodStatus = \"0\". Call generate_boleto " +
      "first if the title has none.",
    path: BOLETO,
    call: "ObterBoleto",
    inputSchema: { type: "object", properties: titleRef, anyOfRequired: titleRefRequired },
  },
  {
    name: "extend_boleto",
    description:
      "Change the due date of a registered boleto in Omie ERP (ProrrogarBoleto). " + BANK_FEES,
    path: BOLETO,
    call: "ProrrogarBoleto",
    inputSchema: {
      type: "object",
      properties: { ...titleRef, dDtVenc: date("New due date") },
      required: ["dDtVenc"],
      anyOfRequired: titleRefRequired,
    },
  },
  {
    name: "cancel_boleto",
    description:
      "Cancel only the boleto of an AR title in Omie ERP (CancelarBoleto, on /financas/contareceberboleto/) " +
      "— not the receivable itself: to cancel the title (status CANCELADO) use cancel_account_receivable. " +
      BANK_FEES,
    path: BOLETO,
    call: "CancelarBoleto",
    inputSchema: { type: "object", properties: titleRef, anyOfRequired: titleRefRequired },
  },
];
