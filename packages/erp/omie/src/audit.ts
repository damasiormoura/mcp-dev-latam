/**
 * Audit trail — who executed which tool.
 *
 * Over the HTTP transport every caller authenticates individually (each person
 * has their own login at the IdP), so the bearer token already identifies a
 * human. Until now the server verified that token and threw the payload away:
 * a settlement posted through `pay_account_payable` was indistinguishable from
 * any other, because the only thing reaching Omie is one shared App Key.
 *
 * This module keeps the identity and records it. Two independent trails come
 * out of it, and they answer different questions:
 *
 *   1. The audit log here — every tool call, whether it succeeded, and which
 *      Omie records it touched. Complete, including reads and failed calls,
 *      but it lives on this side of the API.
 *   2. The attribution stamp (see `stamp` below) — a line appended to the
 *      record's own notes field inside Omie, so someone looking at the order
 *      in the ERP sees who put it there without leaving the ERP. Partial by
 *      nature: only write tools have a notes field to stamp.
 *
 * Neither replaces the other. The log is the record of what this server was
 * asked to do; the stamp is what survives in Omie once it did it.
 *
 * Environment:
 *   MCP_AUDIT_LOG        — path to append JSONL entries to. Unset means stderr
 *                          only, which is lost on `docker rm`; see SELF-HOSTING.
 *   MCP_AUDIT_FULL_ARGS  — "true" logs whole argument objects instead of the
 *                          identifying/monetary summary.
 *   MCP_AUDIT_STAMP      — "false" disables writing attribution into Omie.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createWriteStream, type WriteStream } from "node:fs";

/** The verified caller of the request currently being handled. */
export type Caller = {
  /** IdP subject — stable across an email change, so it is the real key. */
  sub?: string;
  email?: string;
  username?: string;
  /** MCP session the call arrived on; correlates a run of calls by one person. */
  sessionId?: string;
};

/**
 * Identity travels out-of-band rather than as a parameter because the MCP SDK
 * owns the path between the HTTP handler and the tool handler — there is no
 * argument to thread through it. AsyncLocalStorage carries it across that gap
 * without reaching into SDK internals, which is the same reasoning that made
 * buildServer() stop copying `_requestHandlers` off a template instance.
 */
const callerStore = new AsyncLocalStorage<Caller>();

export function withCaller<T>(caller: Caller, fn: () => T): T {
  return callerStore.run(caller, fn);
}

export function currentCaller(): Caller | undefined {
  return callerStore.getStore();
}

/** Human-readable identity for a log line or an ERP note. */
export function callerLabel(caller: Caller | undefined): string {
  if (!identified(caller)) return "unauthenticated";
  return caller.email || caller.username || caller.sub || "unknown";
}

/**
 * Whether we actually know who this is. A caller context always exists over
 * HTTP — it carries the session ID even when enforcement is off — so "there is
 * a context" and "there is a person" are different questions, and only the
 * second one may be written into the ERP.
 */
export function identified(caller: Caller | undefined): caller is Caller {
  return Boolean(caller && (caller.email || caller.username || caller.sub));
}

// ---------------------------------------------------------------------------
// What gets recorded about arguments and responses.
//
// Logging whole payloads would put customer records, addresses and tax IDs in
// a file that exists to answer "who did this" — more exposure than the question
// needs. Logging nothing but the tool name loses the part that matters: *which*
// title was settled, for how much. So the default is a summary of the fields
// that identify the record and the ones that carry money, and an operator who
// wants everything opts in with MCP_AUDIT_FULL_ARGS.
// ---------------------------------------------------------------------------

/**
 * Omie's identifier spellings, across all three of its naming conventions.
 *
 * Note what is deliberately absent: `cnpj_cpf`. A tax ID identifies a person or
 * company rather than a record, and it is redundant here — the Omie ID in the
 * response already points at the exact record this entry is about. Keeping it
 * out means the trail can name who acted without accumulating the registration
 * data of everyone they acted on. MCP_AUDIT_FULL_ARGS overrides this for
 * operators who decide otherwise.
 */
const IDENTIFYING = /^(codigo_|numero_|id_|nCod|cCod|nId|cNum|nNum|nNF|cChave|etapa|cEtapa|tipo|cTipo)/;
/** Amounts and quantities — the fields that make a financial entry meaningful. */
const MONETARY = /^(valor|nValor|nVal|vValor|quantidade|nQtde|quan|juros|desconto|multa)/i;

const SUMMARY_MAX_KEYS = 16;
const SUMMARY_MAX_DEPTH = 3;
const SUMMARY_MAX_STRING = 120;

/**
 * Flattens the interesting scalars out of a nested payload, dotted-path keyed.
 * Bounded in every direction — Omie payloads nest several levels deep and an
 * unbounded walk would put an entire order into one log line.
 */
function summarize(value: unknown, depth = 0, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (depth > SUMMARY_MAX_DEPTH || Object.keys(out).length >= SUMMARY_MAX_KEYS) return out;
  if (!value || typeof value !== "object") return out;

  const entries = Array.isArray(value)
    ? // Only the first element of a list: enough to show what kind of thing it
      // holds without logging a 200-line order item by item.
      value.slice(0, 1).map((v, i) => [`${i}`, v] as const)
    : Object.entries(value as Record<string, unknown>);

  for (const [key, v] of entries) {
    if (Object.keys(out).length >= SUMMARY_MAX_KEYS) break;
    const path = prefix ? `${prefix}.${key}` : key;
    if (v !== null && typeof v === "object") {
      summarize(v, depth + 1, path, out);
    } else if (IDENTIFYING.test(key) || MONETARY.test(key)) {
      if (typeof v === "number" || typeof v === "boolean") out[path] = v;
      else if (typeof v === "string" && v.length <= SUMMARY_MAX_STRING) out[path] = v;
    }
  }
  return out;
}

function summaryOrUndefined(value: unknown): Record<string, unknown> | undefined {
  const s = summarize(value);
  return Object.keys(s).length > 0 ? s : undefined;
}

// ---------------------------------------------------------------------------
// The sink.
// ---------------------------------------------------------------------------

export type AuditEntry = {
  ts: string;
  caller: Caller | null;
  /** Who to blame, flattened for grep. */
  actor: string;
  tool: string;
  /** Omie endpoint and method, so a log line stands on its own. */
  path: string;
  call: string;
  outcome: "ok" | "invalid" | "error" | "demo";
  durationMs: number;
  /** Identifying/monetary fields of the request, or the whole thing under MCP_AUDIT_FULL_ARGS. */
  args?: unknown;
  /** Identifying fields Omie returned — the link from this line to an ERP record. */
  result?: Record<string, unknown>;
  error?: string;
  /** Whether attribution was written into the record's notes field in Omie. */
  stamped?: boolean;
};

const LOG_PATH = process.env.MCP_AUDIT_LOG || "";
const FULL_ARGS = process.env.MCP_AUDIT_FULL_ARGS === "true";

let stream: WriteStream | undefined;
let streamFailed = false;

/**
 * Opened lazily and never fatal: an audit sink that cannot be written to must
 * not take down a server that is otherwise healthy, but it also must not fail
 * silently — the fallback is stderr, which the operator is already reading, and
 * the reason is stated once.
 */
function fileSink(): WriteStream | undefined {
  if (!LOG_PATH || streamFailed) return undefined;
  if (!stream) {
    try {
      stream = createWriteStream(LOG_PATH, { flags: "a" });
      stream.on("error", (err) => {
        if (!streamFailed) {
          streamFailed = true;
          console.error(`Audit log ${LOG_PATH} is not writable (${err.message}); falling back to stderr only.`);
        }
      });
    } catch (err) {
      streamFailed = true;
      console.error(
        `Audit log ${LOG_PATH} could not be opened (${err instanceof Error ? err.message : String(err)}); ` +
          "falling back to stderr only."
      );
      return undefined;
    }
  }
  return stream;
}

/**
 * Writes one entry. stderr always gets it — that is what `docker logs` shows
 * and what a syslog driver ships — and the file is an addition for keeping the
 * trail across container recreation, not a replacement.
 *
 * The `AUDIT ` prefix exists so the trail can be separated from ordinary
 * startup output with a grep rather than a JSON parser that tolerates junk.
 */
export function record(entry: AuditEntry): void {
  const line = JSON.stringify(entry);
  console.error(`AUDIT ${line}`);
  fileSink()?.write(`${line}\n`);
}

/** Builds the entry, keeping the summarize/full-args decision in one place. */
export function buildEntry(fields: {
  caller: Caller | undefined;
  tool: string;
  path: string;
  call: string;
  outcome: AuditEntry["outcome"];
  durationMs: number;
  args?: unknown;
  result?: unknown;
  error?: string;
  stamped?: boolean;
}): AuditEntry {
  return {
    ts: new Date().toISOString(),
    caller: fields.caller ?? null,
    actor: callerLabel(fields.caller),
    tool: fields.tool,
    path: fields.path,
    call: fields.call,
    outcome: fields.outcome,
    durationMs: fields.durationMs,
    ...(fields.args !== undefined
      ? { args: FULL_ARGS ? fields.args : summaryOrUndefined(fields.args) }
      : {}),
    ...(fields.result !== undefined ? { result: summaryOrUndefined(fields.result) } : {}),
    ...(fields.error !== undefined ? { error: fields.error } : {}),
    ...(fields.stamped !== undefined ? { stamped: fields.stamped } : {}),
  };
}

// ---------------------------------------------------------------------------
// Attribution inside Omie.
//
// The audit log above answers "who did this" only for someone holding the log.
// Someone looking at the order in the Omie UI sees the integration app and
// nothing else, because every call carries the same App Key. Appending a line
// to the record's own notes field is the one way to put the person's name where
// that reader is already looking.
//
// It is deliberately not a substitute for the log: only write tools have a
// notes field, Omie's own change history still attributes to the app, and a
// caller can overwrite the note later. It is the visible half of the trail.
// ---------------------------------------------------------------------------

const STAMP_ENABLED = process.env.MCP_AUDIT_STAMP !== "false";

/**
 * ASCII only, and bracketed. Bracketed so a human reading the note can see at
 * a glance which part is machine-appended, and ASCII because these strings can
 * reach fiscal documents where the encoding path is not ours to assume.
 */
export function stampText(caller: Caller | undefined, now = new Date()): string {
  const ts = now.toISOString().slice(0, 16).replace("T", " ");
  return `[via MCP: ${callerLabel(caller)} at ${ts}Z]`;
}

/**
 * Omie does not publish a length limit for these fields and they are not all
 * the same width. Rather than risk turning a working write into a rejected one
 * by pushing a note over an unknown cap, the stamp is skipped when the existing
 * text is already long. The audit log still records the call either way, so the
 * information is never lost — only its visibility inside Omie is.
 */
const STAMP_LENGTH_BUDGET = 500;

/**
 * Where the free-text notes live for a given tool, and whether it is safe to
 * create the field when the caller did not send one.
 *
 * The distinction is load-bearing. On a create there is no prior value, so
 * writing the field is additive. On an update Omie replaces what it is sent —
 * so stamping an update that omitted the field would blank whatever notes the
 * record already had, destroying data to record an audit trail. "if-present"
 * appends only to a value the caller was already going to overwrite.
 */
export type NotesTarget = {
  path: string[];
  when: "always" | "if-present";
};

export function notes(when: NotesTarget["when"], ...path: string[]): NotesTarget {
  return { path, when };
}

/**
 * Appends attribution to the notes field of an assembled param, returning
 * whether anything was written. Mutates a copy, never the caller's object.
 */
export function stamp(
  param: unknown,
  target: NotesTarget | undefined,
  caller: Caller | undefined,
  now = new Date()
): { param: unknown; stamped: boolean } {
  if (!STAMP_ENABLED || !target || !identified(caller) || !param || typeof param !== "object" || Array.isArray(param)) {
    return { param, stamped: false };
  }

  const [field] = target.path.slice(-1);
  const parents = target.path.slice(0, -1);

  // Walk to the parent, cloning each level so the caller's object is untouched.
  const root: Record<string, unknown> = { ...(param as Record<string, unknown>) };
  let node = root;
  for (const key of parents) {
    const child = node[key];
    if (child === undefined || child === null) {
      if (target.when === "if-present") return { param, stamped: false };
      node[key] = {};
    } else if (typeof child !== "object" || Array.isArray(child)) {
      return { param, stamped: false }; // not the shape we expected; leave it alone
    } else {
      node[key] = { ...(child as Record<string, unknown>) };
    }
    node = node[key] as Record<string, unknown>;
  }

  const existing = node[field];
  if (existing !== undefined && existing !== null && typeof existing !== "string") {
    return { param, stamped: false };
  }
  if (target.when === "if-present" && (existing === undefined || existing === null)) {
    return { param, stamped: false };
  }

  const text = stampText(caller, now);
  const prefix = typeof existing === "string" && existing.length > 0 ? `${existing} ` : "";
  if (prefix.length + text.length > STAMP_LENGTH_BUDGET) {
    return { param, stamped: false };
  }

  node[field] = `${prefix}${text}`;
  return { param: root, stamped: true };
}
