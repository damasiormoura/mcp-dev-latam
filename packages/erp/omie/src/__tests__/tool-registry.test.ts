import { describe, it, expect, vi } from "vitest";

describe("tool registry", () => {
  it("refuses to load with two tools of the same name — one would silently shadow the other at dispatch", async () => {
    vi.resetModules();
    vi.doMock("../tools/registry.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../tools/registry.js")>();
      return { registryTools: [...original.registryTools, original.registryTools[0]] };
    });

    await expect(import("../tools/index.js")).rejects.toThrow("Duplicate tool name: get_company_info");
    vi.doUnmock("../tools/registry.js");
  });
});
