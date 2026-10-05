import { OmieTool } from "./types.js";
import { isReadOnlyMethod } from "../omie.js";
import { customerTools } from "./customers.js";
import { productTools } from "./products.js";
import { salesTools } from "./sales.js";
import { purchaseTools } from "./purchases.js";
import { serviceTools } from "./services.js";
import { financeTools } from "./finance.js";
import { cancellationTools } from "./cancellation.js";
import { reconciliationTools } from "./reconciliation.js";
import { billingTools } from "./billing.js";
import { stockTools } from "./stock.js";
import { registryTools } from "./registry.js";

export type { OmieTool } from "./types.js";

/**
 * What the server tells the agent on `initialize`, before any tool is called.
 *
 * Tool descriptions say *what* each tool returns; this says *when* to call
 * them again. Observed 2026-09-21 on the sibling attendance server: in a long
 * chat the agent answered "current" questions from a result read half an hour
 * earlier, because nothing told it the data ages. An ERP is live in exactly
 * the same way — titles get settled, orders move stage, stock moves — so the
 * same rule applies here, plus one about writes: they change a production
 * ERP, so the agent checks the record exists and confirms with the person
 * before creating, settling or cancelling anything.
 */
export const INSTRUCTIONS =
  "This server reads and writes a LIVE Omie ERP (customers, products, orders, invoices, " +
  "receivables, payables, stock). Data changes at any moment, including while this session is " +
  "open: every result is a snapshot of the instant it was read (field read_at). RULE: before " +
  "stating anything about the CURRENT state — an open title, an order's stage, a stock " +
  "position, a customer's details, what changed today — call the tool AGAIN, even if you " +
  "already called it in this conversation. Never answer about current balances, stock or " +
  "orders from chat memory. For 'what changed since…' use the listing tools with " +
  "filtrar_por_data_de / filtrar_por_data_ate (they track creation/alteration time); for one " +
  "record use the get_* tool; for a customer by CNPJ/CPF use list_customers with " +
  "clientesFiltro.cnpj_cpf. WRITES (create_*, update_*, upsert_*, pay_*, receive_*, cancel_*, " +
  "invoice_*, change_*_stage, delete_*; create_invoice is the exception, a read) change the " +
  "production ERP under the caller's name: " +
  "read the record first, prefer upsert_* over create_* when it may already exist, and confirm " +
  "with the person before settling, cancelling or issuing anything. Omie's reply text is not proof of " +
  "the effect (CancelarContaReceber answers \"Boleto cancelado\" when it cancels the title): confirm a " +
  "write by reading the record's status. Right after a write a get_* may still show the old state for " +
  "a few seconds, and an identical call repeated at once is refused as REDUNDANT — confirm through the " +
  "listing tool (get_financial, list_orders, ...), wait the seconds Omie asks before repeating, never " +
  "loop, and never re-send a write because a read looks unchanged. Every result starts with " +
  "`requested` (on an error, its last line): the tool and the arguments it answers. If it does not " +
  "match the call you made, the result belongs to another call — discard it, and never draw a " +
  "conclusion from it or act on it; call a read again, but for a write read the record before sending " +
  "it again, since yours may have run. An error from the connection rather than from this server " +
  "(\"session expired\", connection closed, a timeout) does not mean the call did not run: it may " +
  "have reached Omie. After one on a write, read the record or the listing before sending the write " +
  "again.";

/**
 * Appended to every read tool. Repeated on purpose, not only in `INSTRUCTIONS`:
 * not every MCP client injects the server instructions, and the description is
 * what the model reads when deciding whether to call.
 */
const LIVE_DATA =
  " Live ERP data: the result is a snapshot (read_at) — call again before stating the current " +
  "state, even if already called in this conversation.";

/**
 * Appended to every write tool, for the same reason LIVE_DATA is appended to
 * reads. On 2026-10-05 three calls reached the agent as "session expired"
 * after Claude Code reconnected, and all three ran in Omie. They were reads.
 * For a write, the error would hide an effect that happened, and repeating it
 * would do it twice.
 */
const UNCERTAIN_WRITE =
  " A connection error instead of a result (\"session expired\", connection closed, timeout) does not " +
  "mean this did not run: read the record before sending it again.";

/**
 * A read is decided by the Omie method as well as the name: create_invoice is
 * ConsultarNF — a read with a write's name, kept for compatibility — and it
 * must still carry the live-data clause and the read-only annotation.
 */
export function isRead(tool: OmieTool): boolean {
  return /^(list_|get_)/.test(tool.name) || isReadOnlyMethod(tool.call);
}

/**
 * MCP tool annotations, so a client can tell a read from a write — and a
 * write that only adds (a new order, a settlement, an NF-e) from one that
 * changes or removes what exists — before calling. Derived from the Omie
 * method, which is the one naming this codebase keeps consistent.
 */
export function annotationsFor(tool: OmieTool) {
  const readOnly = isRead(tool);
  return {
    readOnlyHint: readOnly,
    destructiveHint: !readOnly && !/^(Incluir|Gerar|Lancar|Faturar)/.test(tool.call),
    openWorldHint: true,
  };
}

/**
 * The domains, in catalogue order. Also what the README's tool tables are
 * generated from (src/__tests__/readme.test.ts), so a description changed
 * here cannot quietly disagree with the one documented there.
 */
export const TOOL_GROUPS: { title: string; tools: OmieTool[] }[] = [
  { title: "Customers", tools: customerTools },
  { title: "Products", tools: productTools },
  { title: "Sales orders & invoices", tools: salesTools },
  { title: "Purchasing", tools: purchaseTools },
  { title: "Services (OS / NFS-e)", tools: serviceTools },
  { title: "Finance — receivables, payables, ledger", tools: [...financeTools, ...cancellationTools, ...reconciliationTools] },
  { title: "Billing — PIX & boleto", tools: billingTools },
  { title: "Stock", tools: stockTools },
  { title: "Supporting registries", tools: registryTools },
];

export const TOOLS: OmieTool[] = TOOL_GROUPS.flatMap((g) => g.tools).map((tool) =>
  ({ ...tool, description: tool.description + (isRead(tool) ? LIVE_DATA : UNCERTAIN_WRITE) })
);

/** Duplicate tool names would silently shadow each other at dispatch. */
const seen = new Set<string>();
for (const tool of TOOLS) {
  if (seen.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
  seen.add(tool.name);
}

export function findTool(name: string): OmieTool | undefined {
  return TOOLS.find((t) => t.name === name);
}
