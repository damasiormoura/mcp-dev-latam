import { OmieTool } from "./types.js";
import { customerTools } from "./customers.js";
import { productTools } from "./products.js";
import { salesTools } from "./sales.js";
import { purchaseTools } from "./purchases.js";
import { serviceTools } from "./services.js";
import { financeTools } from "./finance.js";
import { cancellationTools } from "./cancellation.js";
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
  "invoice_*, change_*_stage, delete_*) change the production ERP under the caller's name: " +
  "read the record first, prefer upsert_* over create_* when it may already exist, and confirm " +
  "with the person before settling, cancelling or issuing anything.";

/**
 * Appended to every read tool. Repeated on purpose, not only in `INSTRUCTIONS`:
 * not every MCP client injects the server instructions, and the description is
 * what the model reads when deciding whether to call.
 */
const LIVE_DATA =
  " Live ERP data: the result is a snapshot (read_at) — call again before stating the current " +
  "state, even if already called in this conversation.";

function isRead(tool: OmieTool): boolean {
  return /^(list_|get_)/.test(tool.name);
}

export const TOOLS: OmieTool[] = [
  ...customerTools,
  ...productTools,
  ...salesTools,
  ...purchaseTools,
  ...serviceTools,
  ...financeTools,
  ...cancellationTools,
  ...billingTools,
  ...stockTools,
  ...registryTools,
].map((tool) => (isRead(tool) ? { ...tool, description: tool.description + LIVE_DATA } : tool));

/** Duplicate tool names would silently shadow each other at dispatch. */
const seen = new Set<string>();
for (const tool of TOOLS) {
  if (seen.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
  seen.add(tool.name);
}

export function findTool(name: string): OmieTool | undefined {
  return TOOLS.find((t) => t.name === name);
}
