import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../tools/index.js";

/**
 * Schema-versus-documentation contract test.
 *
 * Three separate defect classes in this server came from writing a field name
 * that Omie does not accept:
 *
 *   0.2.3 — two tools called methods that do not exist at all
 *   0.4.0 — seven tools declared filters absent from the request type, which
 *           Omie answers with 200 and the filter silently dropped
 *   0.6.1 — list_stock_adjustments sent nPagina/nRegPorPagina to an endpoint
 *           that spells it pagina/registros_por_pagina, failing every
 *           paginated call
 *
 * The existing tests pin (path, call) and the shape of the assembled param,
 * but none of them could catch a *field name* that simply isn't in Omie's
 * contract — the thing all three had in common. This one does, by asserting
 * every declared property against a fixture generated from Omie's own
 * published reference.
 *
 * The fixture is a committed snapshot rather than a live fetch: CI must not
 * depend on Omie's docs being reachable, and a human should review any change
 * to what the API is believed to accept. Regenerate with:
 *
 *   python3 scripts/omie-doc.py fixture \
 *     --out packages/erp/omie/src/__tests__/fixtures/omie-request-fields.json
 */

type FixtureTool = {
  path: string;
  call: string;
  requestType: string;
  fields: Record<string, { type: string; deprecated: boolean }>;
};

const fixture: { tools: Record<string, FixtureTool> } = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/omie-request-fields.json", import.meta.url)), "utf8")
);

/**
 * Properties the tool layer adds on top of the Omie contract, or nested
 * objects whose members belong to a different complex type than the request
 * root. Anything listed here is exempt from the "must exist in the docs"
 * assertion — deliberately short, and each entry needs a reason.
 */
const NOT_REQUEST_ROOT_FIELDS = new Set<string>([
  // clientesFiltro/clientesPorCodigo are their own complex types; the fixture
  // records them at the root (which is correct) and we pass them through whole.
]);

const documented = Object.entries(fixture.tools);

describe("tool schemas match Omie's published request contract", () => {
  it("covers a meaningful share of the catalogue", () => {
    // Guards against the fixture silently emptying out and the suite passing
    // vacuously.
    expect(documented.length).toBeGreaterThanOrEqual(30);
  });

  describe.each(documented)("%s", (toolName, expected) => {
    const tool = TOOLS.find((t) => t.name === toolName);

    it("is registered, and points at the documented endpoint and method", () => {
      expect(tool, `${toolName} is in the fixture but not in TOOLS`).toBeDefined();
      expect(tool!.path).toBe(expected.path);
      expect(tool!.call).toBe(expected.call);
    });

    it("declares no field absent from the request type", () => {
      const declared = Object.keys((tool!.inputSchema as any).properties ?? {});
      const unknown = declared.filter(
        (f) => !(f in expected.fields) && !NOT_REQUEST_ROOT_FIELDS.has(f)
      );

      expect(
        unknown,
        `${toolName} declares ${unknown.join(", ")}, absent from ${expected.requestType}. ` +
          `Omie either rejects these or silently ignores them.`
      ).toEqual([]);
    });

    it("declares no field Omie marks DEPRECATED", () => {
      const declared = Object.keys((tool!.inputSchema as any).properties ?? {});
      const deprecated = declared.filter((f) => expected.fields[f]?.deprecated);

      expect(deprecated, `${toolName} declares deprecated field(s): ${deprecated.join(", ")}`).toEqual([]);
    });

    it("paginates with the spelling this endpoint actually uses", () => {
      const declared = new Set(Object.keys((tool!.inputSchema as any).properties ?? {}));
      const pageFields = ["pagina", "nPagina"].filter((f) => f in expected.fields);
      const sizeFields = ["registros_por_pagina", "nRegPorPagina", "nRegsPorPagina"].filter(
        (f) => f in expected.fields
      );

      // Only assert for endpoints that actually paginate.
      if (pageFields.length > 0) {
        expect(
          pageFields.some((f) => declared.has(f)),
          `${toolName} must use ${pageFields.join(" or ")} — Omie's other spellings are rejected or ignored here`
        ).toBe(true);
      }
      if (sizeFields.length > 0) {
        expect(
          sizeFields.some((f) => declared.has(f)),
          `${toolName} must use ${sizeFields.join(" or ")}`
        ).toBe(true);
      }
    });
  });
});

describe("param builders send the documented pagination fields", () => {
  it.each(documented.filter(([, e]) => "pagina" in e.fields || "nPagina" in e.fields))(
    "%s",
    (toolName, expected) => {
      const tool = TOOLS.find((t) => t.name === toolName)!;
      const sent = tool.param ? (tool.param({}) as Record<string, unknown>) : {};

      // Whatever defaults the builder injects must themselves be real fields.
      const invented = Object.keys(sent).filter((f) => !(f in expected.fields));
      expect(
        invented,
        `${toolName}'s param builder injects ${invented.join(", ")}, absent from ${expected.requestType}`
      ).toEqual([]);
    }
  );
});
