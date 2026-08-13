/**
 * Tool definitions are declarative: each one carries the Omie endpoint and
 * method it maps to, so dispatch is a lookup rather than a switch statement.
 * That keeps the endpoint/method pair — the part that was wrong in seven tools
 * before 0.2.3 — visible next to the schema it belongs to, and lets the
 * contract test derive its expectations from the definitions themselves.
 */
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
