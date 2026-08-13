import { OmieTool } from "./types.js";
import { customerTools } from "./customers.js";
import { productTools } from "./products.js";
import { salesTools } from "./sales.js";
import { purchaseTools } from "./purchases.js";
import { serviceTools } from "./services.js";
import { financeTools } from "./finance.js";
import { billingTools } from "./billing.js";
import { stockTools } from "./stock.js";
import { registryTools } from "./registry.js";

export type { OmieTool } from "./types.js";

export const TOOLS: OmieTool[] = [
  ...customerTools,
  ...productTools,
  ...salesTools,
  ...purchaseTools,
  ...serviceTools,
  ...financeTools,
  ...billingTools,
  ...stockTools,
  ...registryTools,
];

/** Duplicate tool names would silently shadow each other at dispatch. */
const seen = new Set<string>();
for (const tool of TOOLS) {
  if (seen.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
  seen.add(tool.name);
}

export function findTool(name: string): OmieTool | undefined {
  return TOOLS.find((t) => t.name === name);
}
