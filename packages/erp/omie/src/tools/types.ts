/**
 * Tool definitions are declarative: each one carries the Omie endpoint and
 * method it maps to, so dispatch is a lookup rather than a switch statement.
 * That keeps the endpoint/method pair — the part that was wrong in seven tools
 * before 0.2.3 — visible next to the schema it belongs to, and lets the
 * contract test derive its expectations from the definitions themselves.
 */
import type { NotesTarget } from "../audit.js";

export { notes } from "../audit.js";
export type { NotesTarget } from "../audit.js";
export type OmieTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Omie endpoint path, e.g. "/geral/clientes/". */
  path: string;
  /** Omie method name, e.g. "ListarClientes". */
  call: string;
  /**
   * Builds the single `param` entry from the tool arguments. Defaults to
   * passing them through unchanged, which is correct for every tool whose
   * schema mirrors the Omie request type field for field.
   */
  param?: (args: Record<string, unknown>) => unknown;
  /**
   * Where this tool's free-text notes field lives, when it has one. Used to
   * append caller attribution so the person behind a change is visible inside
   * Omie itself — every call reaches Omie under the same App Key, so without
   * this the ERP's own history shows only the integration app.
   *
   * Declared here, next to the schema, for the same reason `path` and `call`
   * are: the field name has to match the Omie request type, and that is the
   * one place it can be checked against it.
   */
  notes?: NotesTarget;
};

/**
 * Omie caps every listing at 100 records per page. Without a declared maximum
 * an agent asking for 500 just gets an error from the far end.
 */
export const MAX_PAGE_SIZE = 100;

/**
 * Omie uses three different spellings for pagination depending on the vintage
 * of the endpoint. They are not interchangeable — sending `pagina` to an
 * endpoint that wants `nPagina` silently returns page 1 forever.
 */
export const PAGING = {
  snake: { page: "pagina", size: "registros_por_pagina" },
  n: { page: "nPagina", size: "nRegPorPagina" },
  /** Purchase orders alone spell it "nRegsPorPagina". */
  nRegs: { page: "nPagina", size: "nRegsPorPagina" },
} as const;

export type PagingStyle = keyof typeof PAGING;

/** Schema fragment for the two pagination properties of a listing tool. */
export function pagingSchema(style: PagingStyle): Record<string, unknown> {
  const { page, size } = PAGING[style];
  return {
    [page]: { type: "number", description: "Page number (default 1)" },
    [size]: {
      type: "number",
      maximum: MAX_PAGE_SIZE,
      description: `Records per page (default 50, max ${MAX_PAGE_SIZE})`,
    },
  };
}

/**
 * Param builder that applies pagination defaults and passes every other
 * argument through. `pageSize` defaults to 50 rather than Omie's own default so
 * a listing stays a predictable size regardless of endpoint.
 */
export function withPaging(style: PagingStyle) {
  const { page, size } = PAGING[style];
  return (args: Record<string, unknown>) => ({
    ...args,
    [page]: args[page] ?? 1,
    [size]: args[size] ?? 50,
  });
}

/** Convenience for the many tools whose only inputs are a page and a size. */
export function listOnly(style: PagingStyle): Pick<OmieTool, "inputSchema" | "param"> {
  return {
    inputSchema: { type: "object", properties: pagingSchema(style) },
    param: withPaging(style),
  };
}

/** A DD/MM/YYYY date property. */
export function date(description: string) {
  return { type: "string", description: `${description} (DD/MM/YYYY)` };
}

/** An "S"/"N" flag property, which is how Omie spells booleans. */
export function flag(description: string) {
  return { type: "string", enum: ["S", "N"], description };
}

/**
 * The "records created or changed in this window" filter set, which Omie
 * repeats verbatim across most snake_case listing endpoints. Note these track
 * *inclusion/alteration* time, not the business date of the record — an
 * endpoint that also filters by issue or due date spells that separately
 * (filtrar_por_emissao_*, dDtVenc*, and so on).
 */
export function changeTrackingFilters(): Record<string, unknown> {
  return {
    filtrar_por_data_de: date("Filter records created/changed from this date"),
    filtrar_por_data_ate: date("Filter records created/changed up to this date"),
    filtrar_apenas_inclusao: flag("Only newly created records"),
    filtrar_apenas_alteracao: flag("Only changed records"),
  };
}

/**
 * Ordering, where the endpoint documents it. Worth exposing because without it
 * an agent looking for "the most recent N" has to page through everything.
 *
 * `descField` must be passed per endpoint and can be omitted entirely, because
 * Omie is not consistent here and guessing gets it wrong three different ways:
 * some endpoints ship the correctly-spelled `ordem_decrescente`, some ship
 * only the misspelled `ordem_descrescente`, some ship both with one marked
 * DEPRECATED, and /estoque/ajuste/ has no descending flag at all. The contract
 * test checks each choice against the published request type.
 */
export function orderingFilters(byField: string, descField?: string): Record<string, unknown> {
  return {
    [byField]: { type: "string", description: "Sort key, e.g. CODIGO (endpoint-specific; defaults to code order)" },
    ...(descField ? { [descField]: flag("Sort descending") } : {}),
  };
}
