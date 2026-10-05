import { OmieTool, RunContext, ToolRefusal, flag } from "./types.js";

const SRV = "/servicos/servico/";

/**
 * Changing a registered service (AlterarCadastroServico).
 *
 * Production, 2026-10-05: three NFS-e of Ribeirão Preto were rejected until
 * each OS item carried the right municipal code and IBS/CBS fields, and the
 * defaults every new OS inherits live in the service catalogue — which this
 * server could read (list_services) but not change, so the fix had to be made
 * by hand, service by service.
 *
 * It is a multi-step tool because Omie's reference does not say whether
 * AlterarCadastroServico merges what it is sent or replaces the record with
 * it, and a replace would blank every field the caller did not mention:
 *
 *   1. Read the service (ConsultarCadastroServico).
 *   2. Refuse when it carries blocks this tool does not edit and so would not
 *      send back — products used, or a via-única invoice setup — rather than
 *      risk dropping them.
 *   3. Send the whole record read in step 1, with only the requested fields
 *      changed; skip the write entirely when nothing differs.
 *   4. Confirm through ListarCadastroServico filtered by the service code. The
 *      same Consultar repeated at once would be refused as REDUNDANT.
 */

/** cabecalho fields Omie documents as "used only by Consulta/Listagem" — not sent back. */
const LISTING_ONLY = new Set(["cTipoDesc", "nValorDesc", "nAliqDesc"]);

/** The blocks of srvEditarRequest this tool edits, in the order changes are reported. */
const BLOCKS = ["cabecalho", "descricao", "impostos"] as const;
type Block = (typeof BLOCKS)[number];

type Change = { campo: string; antes: unknown; depois: unknown };

const same = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");

function requestedChanges(current: any, args: Record<string, unknown>): Change[] {
  const changes: Change[] = [];
  for (const block of BLOCKS) {
    const wanted = (args[block] ?? {}) as Record<string, unknown>;
    for (const [field, value] of Object.entries(wanted)) {
      const before = current?.[block]?.[field];
      if (!same(before, value)) changes.push({ campo: `${block}.${field}`, antes: before ?? null, depois: value });
    }
  }
  return changes;
}

function blocksNotEdited(current: any): string[] {
  const reasons: string[] = [];
  const produtos = current?.produtosUtilizados?.produtoUtilizado;
  if (Array.isArray(produtos) && produtos.length > 0) reasons.push(`${produtos.length} produto(s) utilizado(s)`);
  if (current?.viaUnica?.cUtilizaViaUnica === "S") reasons.push("NF via única (modelos 21/22)");
  return reasons;
}

async function confirm(ctx: RunContext, nCodServ: number, cCodigo: unknown, changes: Change[]) {
  try {
    const listed = await ctx.request(SRV, "ListarCadastroServico", { nPagina: 1, nRegPorPagina: 50, cCodigo });
    const after = ((listed?.cadastros ?? []) as any[]).find((s) => s?.intListar?.nCodServ === nCodServ);
    if (!after) {
      return { confirmado: false, detalhe: `service ${nCodServ} not in the listing for code ${cCodigo} — check again with list_services` };
    }
    const divergencias = changes
      .map(({ campo, depois }) => {
        const [block, field] = campo.split(".");
        return { campo, pedido: depois, gravado: after[block]?.[field] ?? null };
      })
      .filter((d) => !same(d.pedido, d.gravado));
    return divergencias.length === 0 ? { confirmado: true } : { confirmado: false, divergencias };
  } catch (err) {
    return { confirmado: false, detalhe: `verification listing failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function updateService(args: Record<string, unknown>, ctx: RunContext) {
  const wanted = BLOCKS.flatMap((b) => Object.keys((args[b] ?? {}) as object));
  if (wanted.length === 0) {
    throw new ToolRefusal("Nothing to change: pass at least one field in cabecalho, descricao or impostos.");
  }

  const key = args.intEditar as Record<string, unknown>;
  const lookup = key.nCodServ !== undefined ? { nCodServ: key.nCodServ } : { cCodIntServ: key.cCodIntServ };
  const current = await ctx.request(SRV, "ConsultarCadastroServico", lookup);
  const nCodServ = current?.intListar?.nCodServ;
  if (typeof nCodServ !== "number") throw new ToolRefusal(`Omie returned no service for ${JSON.stringify(lookup)}.`);
  const cCodigo = current.cabecalho?.cCodigo;

  const notEdited = blocksNotEdited(current);
  if (notEdited.length > 0) {
    throw new ToolRefusal(
      `Service ${cCodigo} (${nCodServ}) has ${notEdited.join(" and ")}. This tool does not edit those blocks and ` +
        "will not risk dropping them by sending the record without them — change this service in Omie itself."
    );
  }

  const changes = requestedChanges(current, args);
  if (changes.length === 0) {
    return { nCodServ, cCodigo, alteracoes: [], aviso: "O cadastro já tem esses valores — nada foi gravado." };
  }

  const param: Record<Block | "intEditar", Record<string, unknown>> = {
    intEditar: { nCodServ },
    cabecalho: Object.fromEntries(Object.entries(current.cabecalho ?? {}).filter(([k]) => !LISTING_ONLY.has(k))),
    descricao: { ...current.descricao },
    impostos: { ...current.impostos },
  };
  for (const block of BLOCKS) Object.assign(param[block], args[block] ?? {});

  const resposta = await ctx.request(SRV, "AlterarCadastroServico", param);
  const verificacao = await confirm(ctx, nCodServ, cCodigo, changes);

  return { nCodServ, cCodigo, alteracoes: changes, resposta_omie: resposta, verificacao };
}

const text = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });

/** IBS/CBS codes keep their leading zeros: "000001", not 1. */
const IBS_CBS = {
  cCstIbsCbs: text("IBS/CBS tax situation code (CST), 3 digits, e.g. \"000\" = tributação integral"),
  cClassTrib: text("IBS/CBS tax classification code (cClassTrib), 6 digits, e.g. \"000001\""),
  cIndOper: text(
    "Operation indicator (cIndOp), 6 digits. Must correlate with the national tax code (LC 116 item) and NBS — " +
      "the city hall rejects a mismatch with EM062. For 17.09 / NBS 114044300 the only valid value is \"100301\""
  ),
  nAliqCbs: num("CBS rate (%)"),
  nAliqIbsUf: num("State IBS rate (%)"),
  nAliqIbsMun: num("Municipal IBS rate (%)"),
  nPercReducaoCbs: num("CBS reduction (%)"),
  nPercReducaoIbsUf: num("State IBS reduction (%)"),
  nPercReducaoIbsMun: num("Municipal IBS reduction (%)"),
};

export const updateServiceTool: OmieTool = {
  name: "update_service",
  description:
    "Change a registered service in Omie ERP's service catalogue (AlterarCadastroServico) — the codes and tax " +
    "fields every NEW service order inherits: municipal service code, LC 116 item, NBS, taxation type, ISS and " +
    "withholdings, and the IBS/CBS fields (CST, cClassTrib, cIndOper, rates). Service orders that already exist " +
    "keep their own copy: fix those with update_service_order. Identify the service by intEditar.nCodServ " +
    "(intListar.nCodServ in list_services; filter that by cCodigo, e.g. \"SRV00001\"). Send only the fields to " +
    "change: the tool reads the service, sends the whole record back with just those fields changed (writing " +
    "nothing if they already match), and confirms through the listing. It refuses a service that has products " +
    "used or a via-única invoice setup, which it does not edit.",
  path: SRV,
  call: "AlterarCadastroServico",
  inputSchema: {
    type: "object",
    properties: {
      intEditar: {
        type: "object",
        description: "Which service to change",
        properties: {
          nCodServ: num("Service ID — intListar.nCodServ in list_services (nCodServico on service-order items)"),
          cCodIntServ: text("Service integration code (alternative)"),
        },
        anyOfRequired: ["nCodServ", "cCodIntServ"],
      },
      cabecalho: {
        type: "object",
        description: "Service header fields to change",
        properties: {
          cDescricao: text("Short description"),
          cIdTrib: text("Taxation type (ID da tributação), 2 chars, e.g. \"01\" — values vary by city"),
          cCodServMun: text(
            "Municipal service code. Ribeirão Preto accepted \"170901/170901\" (the national code twice) in October " +
              "2026 and rejected \"170901/7120100\" (CNAE in the second half) with EM076 / E0314"
          ),
          cCodLC116: text("LC 116 service item, e.g. \"17.09\""),
          nIdNBS: text("NBS code, 9 digits, e.g. \"114044300\""),
          nPrecoUnit: num("Unit price in BRL"),
          cCodCateg: text("Category code (list_categories)"),
        },
      },
      descricao: {
        type: "object",
        properties: { cDescrCompleta: text("Full description") },
      },
      impostos: {
        type: "object",
        description: "ISS, withholdings and IBS/CBS fields to change",
        properties: {
          nAliqISS: num("ISS rate (%)"),
          cRetISS: flag("Withhold ISS"),
          nAliqPIS: num("PIS rate (%)"),
          cRetPIS: flag("Withhold PIS"),
          nAliqCOFINS: num("COFINS rate (%)"),
          cRetCOFINS: flag("Withhold COFINS"),
          nAliqCSLL: num("CSLL rate (%)"),
          cRetCSLL: flag("Withhold CSLL"),
          nAliqIR: num("IR rate (%)"),
          cRetIR: flag("Withhold IR"),
          nAliqINSS: num("INSS rate (%)"),
          cRetINSS: flag("Withhold INSS"),
          nRedBaseINSS: num("INSS base reduction (%)"),
          nRedBasePIS: num("PIS base reduction (%)"),
          nRedBaseCOFINS: num("COFINS base reduction (%)"),
          lDeduzISS: { type: "boolean", description: "Deduct ISS from the PIS/COFINS base" },
          ...IBS_CBS,
        },
      },
    },
    required: ["intEditar"],
    anyOfRequired: ["cabecalho", "descricao", "impostos"],
  },
  run: updateService,
};
