/**
 * Omie transport and request validation.
 *
 * Omie speaks a JSON-RPC-ish dialect: every call is a POST whose body carries
 * `call`, `app_key`, `app_secret` and a single-element `param` array.
 */

const APP_KEY = process.env.OMIE_APP_KEY || "";
const APP_SECRET = process.env.OMIE_APP_SECRET || "";
const BASE_URL = "https://app.omie.com.br/api/v1";

export const CREDENTIALS_CONFIGURED = Boolean(APP_KEY && APP_SECRET);

// ---------------------------------------------------------------------------
// Timeout, retry and backoff.
//
// Omie's published limits: 960 req/min per IP, 240 req/min per IP + App Key +
// method, 4 concurrent requests per IP + App Key + method, and — the sharp
// edge — an IP + App Key + method combination is blocked for 30 minutes
// (HTTP 425) after 10 consecutive errors. A naive retry-everything policy
// makes that worse, not better: Omie funnels both transient instability and
// permanent business errors ("cliente não encontrado", a malformed field)
// through plain HTTP 500, so retrying every 500 would retry the unretryable
// case too and burn through the same 10-error budget that trips the block —
// automating the exact failure mode this exists to prevent.
//
// So retries are deliberately narrow:
//   - Only read-only Omie methods are retried at all (see isReadOnlyMethod).
//     A write's timeout is ambiguous — the request may have already reached
//     Omie and been processed even though no response came back — and
//     retrying a create/settle/issue call on that ambiguity risks a second
//     order, a second payment, a second invoice. Reads have no such risk:
//     replaying a Listar/Consultar/Obter is always safe.
//   - Only network failures (DNS, connection reset, our own request timeout)
//     and the unambiguous infrastructure codes 502/503/504 are retried.
//     Plain 500 is never retried, for the reason above — it surfaces
//     immediately with the parsed faultstring so the agent can decide.
//   - HTTP 425 is never retried under any circumstance: retrying into an
//     active block cannot succeed and only risks extending it.
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = Number(process.env.OMIE_REQUEST_TIMEOUT_MS) || 20_000;
const MAX_RETRIES = 2; // up to 3 attempts total
const BASE_BACKOFF_MS = 400;
const MAX_BACKOFF_MS = 4_000;
const RETRYABLE_HTTP_STATUSES = new Set([502, 503, 504]);

/**
 * Omie's naming convention is consistent across every endpoint this server
 * covers: a method that reads is always Listar*, Consultar*, Obter*,
 * Pesquisar*, Status*, Simular* or Validar* (Validar and Simular are
 * explicitly non-committing — they check feasibility or price without
 * creating anything), plus the one-off PosicaoEstoque. Everything else
 * (Incluir, Alterar, Excluir, Cancelar, Lancar, Faturar, Trocar, Devolver,
 * Gerar, Upsert, ...) commits a change. An unrecognized prefix is treated as
 * a write — the safe default when a new tool's method doesn't match a known
 * read pattern is "don't retry it automatically", not the other way round.
 */
function isReadOnlyMethod(call: string): boolean {
  return /^(Listar|Consultar|Obter|Pesquisar|Status|Simular|Validar|Posicao)/.test(call);
}

function isRetryable(call: string, err: unknown): boolean {
  if (!isReadOnlyMethod(call)) return false;
  if (err instanceof OmieApiError) return RETRYABLE_HTTP_STATUSES.has(err.httpStatus);
  // fetch() throws TypeError on network failure and rejects with an
  // AbortError-shaped DOMException when our own timeout fires — both mean the
  // request never got a response, which is safe to retry for a read.
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number): number {
  const exp = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  return exp + Math.random() * exp * 0.25; // up to 25% jitter, to avoid retry storms in lockstep
}

// ---------------------------------------------------------------------------
// Structured errors.
//
// Omie returns a business error as HTTP 500 with a JSON body carrying
// `faultstring` (human-readable) and `faultcode` (a stable identifier). The
// previous implementation dropped the response straight into a generic
// `Error`, so the agent saw an opaque
// `Omie API 500: {"faultstring":"...","faultcode":"..."}` string. Parsing it
// out lets the message distinguish "this customer ID doesn't exist" from
// "the service is unstable" — and lets isRetryable branch on httpStatus
// without re-parsing text.
// ---------------------------------------------------------------------------

export class OmieApiError extends Error {
  readonly httpStatus: number;
  readonly faultCode?: string;
  readonly faultString?: string;
  readonly raw: string;

  constructor(httpStatus: number, raw: string) {
    let faultCode: string | undefined;
    let faultString: string | undefined;
    try {
      const body = JSON.parse(raw);
      if (typeof body?.faultstring === "string") faultString = body.faultstring;
      if (typeof body?.faultcode === "string") faultCode = body.faultcode;
    } catch {
      // Not JSON, or not the fault shape — raw is all there is to show.
    }

    super(OmieApiError.formatMessage(httpStatus, faultCode, faultString, raw));
    this.name = "OmieApiError";
    this.httpStatus = httpStatus;
    this.faultCode = faultCode;
    this.faultString = faultString;
    this.raw = raw;
  }

  private static formatMessage(httpStatus: number, faultCode: string | undefined, faultString: string | undefined, raw: string): string {
    if (httpStatus === 425) {
      return (
        "Omie API 425: this IP + App Key + method combination was blocked for 30 minutes " +
        "after repeated errors. Do not retry this call now — fix the underlying problem " +
        "(check the faultstring/faultcode below if present) and wait before trying again." +
        (faultString ? `\nfaultstring: ${faultString}` : "") +
        (faultCode ? `\nfaultcode: ${faultCode}` : "")
      );
    }
    if (faultString || faultCode) {
      return (
        `Omie API error (HTTP ${httpStatus})` +
        (faultCode ? `\nfaultcode: ${faultCode}` : "") +
        (faultString ? `\nfaultstring: ${faultString}` : "")
      );
    }
    return `Omie API ${httpStatus}: ${raw}`;
  }
}

export async function omieRequest(path: string, call: string, param: unknown[]): Promise<unknown> {
  if (!CREDENTIALS_CONFIGURED) {
    throw new Error(
      "OMIE_APP_KEY and OMIE_APP_SECRET must both be set — this server cannot authenticate " +
        "to Omie without them. Set both environment variables, or pass --demo / MCP_DEMO=true " +
        "to run without live credentials."
    );
  }

  let attempt = 0;
  for (;;) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          call,
          app_key: APP_KEY,
          app_secret: APP_SECRET,
          param,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new OmieApiError(res.status, await res.text());
      }
      return await res.json();
    } catch (err) {
      attempt++;
      if (attempt > MAX_RETRIES || !isRetryable(call, err)) throw err;
      await sleep(backoffDelay(attempt));
    }
  }
}

/**
 * Minimal request validation.
 *
 * The Omie API answers a malformed `param` with an HTTP 500 carrying a
 * faultstring, which reaches the agent as an opaque remote failure. Walking the
 * tool's own inputSchema first turns "required field missing" or "wrong type"
 * into a local, actionable message — and, since the schemas mirror the
 * documented contract, it catches exactly the mistakes that would otherwise
 * reach Omie.
 *
 * Covers: required fields, object/array/string/number/boolean type mismatches,
 * `enum`, numeric `minimum`/`maximum`, and — via the non-standard
 * `anyOfRequired: string[]` property on an object schema — "identify this
 * record via at least one of these sibling fields" (e.g. `codigo_produto` or
 * `codigo_produto_integracao`). That single construct covers every case in
 * this codebase that needed cross-field validation: every one of them is
 * "pick one of N alternative ID fields", never a true divergent-subschema
 * `oneOf`. A schema requiring the fuller thing — genuinely different shapes
 * depending on which branch is taken — would need real `oneOf`/`anyOf`
 * subschema resolution, which this validator deliberately doesn't implement;
 * no tool here has needed it yet.
 */
export function validateArgs(schema: any, value: unknown, path = ""): string[] {
  if (!schema || typeof schema !== "object") return [];
  const here = path || "arguments";
  const errors: string[] = [];

  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return [`${here} must be an object`];
      }
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (obj[key] === undefined || obj[key] === null) {
          errors.push(`${path ? `${path}.` : ""}${key} is required`);
        }
      }
      if (Array.isArray(schema.anyOfRequired) && schema.anyOfRequired.length > 0) {
        const satisfied = schema.anyOfRequired.some(
          (key: string) => obj[key] !== undefined && obj[key] !== null
        );
        if (!satisfied) {
          errors.push(`${here} must include at least one of: ${schema.anyOfRequired.join(", ")}`);
        }
      }
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (obj[key] !== undefined && obj[key] !== null) {
          errors.push(...validateArgs(sub, obj[key], path ? `${path}.${key}` : key));
        }
      }
      break;
    }
    case "array": {
      if (!Array.isArray(value)) return [`${here} must be an array`];
      if (schema.minItems && value.length < schema.minItems) {
        errors.push(`${here} must have at least ${schema.minItems} item(s)`);
      }
      value.forEach((item, i) => errors.push(...validateArgs(schema.items, item, `${here}[${i}]`)));
      break;
    }
    case "string": {
      if (typeof value !== "string") return [`${here} must be a string`];
      if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
        errors.push(`${here} must be one of: ${schema.enum.join(", ")} (got "${value}")`);
      }
      break;
    }
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) return [`${here} must be a number`];
      if (typeof schema.maximum === "number" && value > schema.maximum) {
        errors.push(`${here} must be at most ${schema.maximum} (got ${value})`);
      }
      if (typeof schema.minimum === "number" && value < schema.minimum) {
        errors.push(`${here} must be at least ${schema.minimum} (got ${value})`);
      }
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") return [`${here} must be a boolean`];
      break;
    }
  }

  return errors;
}
