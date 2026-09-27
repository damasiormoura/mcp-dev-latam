import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOOL_GROUPS } from "../tools/index.js";
import type { OmieTool } from "../tools/types.js";

/**
 * The README's tool tables are generated from the tool definitions.
 *
 * They used to be written by hand and had drifted: cancel_boleto was still
 * "Cancel a boleto in Omie ERP" there after its description gained the part
 * that mattered (it does not cancel the title). This test regenerates the
 * section between the markers and fails when the README differs. To update:
 *
 *   UPDATE_README=1 npx vitest run packages/erp/omie/src/__tests__/readme.test.ts
 */

const README = fileURLToPath(new URL("../../README.md", import.meta.url));
const BEGIN = "<!-- tools:begin — generated from src/tools by readme.test.ts; do not edit by hand -->";
const END = "<!-- tools:end -->";

/** The description's first sentence, minus the "(OmieMethod...)" the method column already shows. */
function purpose(tool: OmieTool): string {
  const first = /^(.*?[.!?])(?=\s+[A-Z(`"]|$)/s.exec(tool.description)?.[1] ?? tool.description;
  return first
    .replace(new RegExp(`\\s*\\(${tool.call}[^)]*\\)`), "")
    .replace(/\.$/, "")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

export function renderTools(): string {
  const total = TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0);
  const sections = TOOL_GROUPS.map((g) =>
    [
      `### ${g.title} (${g.tools.length})`,
      "",
      "| Tool | Omie method | Purpose |",
      "|---|---|---|",
      ...g.tools.map((t) => `| \`${t.name}\` | \`${t.call}\` | ${purpose(t)} |`),
    ].join("\n")
  );
  return [
    BEGIN,
    `## Tools (${total})`,
    "",
    "> Conformance status of each tool against the official Omie API reference:",
    "> [`API-AUDIT.md`](./API-AUDIT.md). Every tool carries the Omie method it maps",
    "> to; the contract test pins each pair. The full description of each tool —",
    "> what it does not do, what to call before and how to undo it — is in",
    "> `src/tools/`, and is what the agent reads.",
    "",
    sections.join("\n\n"),
    END,
  ].join("\n");
}

describe("README tool tables", () => {
  it("match the tool definitions", () => {
    const readme = readFileSync(README, "utf8");
    const start = readme.indexOf(BEGIN);
    const end = readme.indexOf(END);
    expect(start, "README is missing the tools:begin marker").toBeGreaterThanOrEqual(0);
    expect(end, "README is missing the tools:end marker").toBeGreaterThan(start);

    const current = readme.slice(start, end + END.length);
    const expected = renderTools();
    if (process.env.UPDATE_README === "1" && current !== expected) {
      writeFileSync(README, readme.slice(0, start) + expected + readme.slice(end + END.length));
      return;
    }
    expect(current, "README tool tables are stale — rerun with UPDATE_README=1").toBe(expected);
  });
});
