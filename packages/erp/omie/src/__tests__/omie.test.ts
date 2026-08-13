import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.OMIE_APP_KEY = "test-key";
process.env.OMIE_APP_SECRET = "test-secret";

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)), json: () => Promise.resolve(body) };
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  mockFetch.mockReset();
  global.fetch = mockFetch as any;
});

afterEach(() => {
  vi.useRealTimers();
});

/** Advances fake timers while letting pending microtasks (the retry loop's awaits) settle between ticks. */
async function flushTimers(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("omieRequest — retry policy", () => {
  it("retries a read-only call on a network failure and eventually succeeds", async () => {
    const { omieRequest } = await import("../omie.js");

    mockFetch
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const promise = omieRequest("/geral/clientes/", "ListarClientes", [{}]);
    await flushTimers(5_000);

    await expect(promise).resolves.toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries a read-only call on 503 but not on plain 500", async () => {
    const { omieRequest, OmieApiError } = await import("../omie.js");

    mockFetch
      .mockResolvedValueOnce(jsonResponse(503, { faultstring: "temporarily unavailable" }))
      .mockResolvedValueOnce(jsonResponse(500, { faultstring: "Cliente não encontrado.", faultcode: "SOAP-ENV:Client-101" }));

    const promise = omieRequest("/geral/clientes/", "ConsultarCliente", [{}]);
    promise.catch(() => {}); // avoid an unhandled-rejection warning while timers are advanced below
    await flushTimers(5_000);

    await expect(promise).rejects.toThrow(OmieApiError);
    // One call for the 503, one retry that got the 500 — and no further retry
    // after that, because plain 500 is never retried.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("never retries a write call, even on a network failure", async () => {
    const { omieRequest } = await import("../omie.js");

    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(omieRequest("/geral/clientes/", "IncluirCliente", [{}])).rejects.toThrow("fetch failed");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("never retries HTTP 425, on a read or a write", async () => {
    const { omieRequest, OmieApiError } = await import("../omie.js");

    mockFetch.mockResolvedValue(jsonResponse(425, {}));

    await expect(omieRequest("/geral/clientes/", "ListarClientes", [{}])).rejects.toThrow(OmieApiError);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockClear();
    mockFetch.mockResolvedValue(jsonResponse(425, {}));
    await expect(omieRequest("/geral/clientes/", "IncluirCliente", [{}])).rejects.toThrow(OmieApiError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry budget on a persistently failing read", async () => {
    const { omieRequest } = await import("../omie.js");

    mockFetch.mockRejectedValue(new TypeError("fetch failed"));

    const promise = omieRequest("/geral/clientes/", "ListarClientes", [{}]);
    promise.catch(() => {});
    await flushTimers(20_000);

    await expect(promise).rejects.toThrow("fetch failed");
    // MAX_RETRIES = 2 -> 3 attempts total, never unbounded.
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("passes an AbortSignal so a hung request cannot block forever", async () => {
    const { omieRequest } = await import("../omie.js");

    mockFetch.mockResolvedValueOnce(jsonResponse(200, {}));
    await omieRequest("/geral/clientes/", "ListarClientes", [{}]);

    const init = mockFetch.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("omieRequest — read/write classification", () => {
  it.each([
    ["ListarClientes", true], ["ConsultarPedido", true], ["ObterNfe", true],
    ["PesquisarPedCompra", true], ["StatusPedido", true], ["SimularImpostos", true],
    ["ValidarPedidoVenda", true], ["PosicaoEstoque", true],
    ["IncluirCliente", false], ["AlterarOS", false], ["ExcluirPedido", false],
    ["CancelarPix", false], ["LancarPagamento", false], ["FaturarOS", false],
    ["TrocarEtapaPedido", false], ["DevolverPedido", false], ["GerarBoleto", false],
    ["UpsertProduto", false],
  ])("%s is retryable on network failure: %s", async (call, expectRetried) => {
    const { omieRequest } = await import("../omie.js");
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));

    const promise = omieRequest("/x/", call, [{}]);
    promise.catch(() => {});
    await flushTimers(20_000);
    await expect(promise).rejects.toThrow();

    expect(mockFetch).toHaveBeenCalledTimes(expectRetried ? 3 : 1);
  });
});

describe("OmieApiError", () => {
  it("parses faultcode/faultstring out of the JSON body", async () => {
    const { OmieApiError } = await import("../omie.js");
    const err = new OmieApiError(500, JSON.stringify({ faultstring: "Cliente não encontrado.", faultcode: "SOAP-ENV:Client-101" }));

    expect(err.httpStatus).toBe(500);
    expect(err.faultString).toBe("Cliente não encontrado.");
    expect(err.faultCode).toBe("SOAP-ENV:Client-101");
    expect(err.message).toContain("Cliente não encontrado.");
    expect(err.message).toContain("SOAP-ENV:Client-101");
  });

  it("falls back to the raw body when it isn't the fault shape", async () => {
    const { OmieApiError } = await import("../omie.js");
    const err = new OmieApiError(502, "<html>Bad Gateway</html>");

    expect(err.faultString).toBeUndefined();
    expect(err.message).toContain("<html>Bad Gateway</html>");
  });

  it("gives 425 a distinct, explicit do-not-retry message", async () => {
    const { OmieApiError } = await import("../omie.js");
    const err = new OmieApiError(425, JSON.stringify({}));

    expect(err.message).toMatch(/30 minutes/);
    expect(err.message).toMatch(/do not retry/i);
  });
});

describe("omieRequest — credentials", () => {
  it("fails fast, without a network call, when credentials are missing", async () => {
    const prevKey = process.env.OMIE_APP_KEY;
    const prevSecret = process.env.OMIE_APP_SECRET;
    delete process.env.OMIE_APP_KEY;
    delete process.env.OMIE_APP_SECRET;
    vi.resetModules();

    const { omieRequest } = await import("../omie.js");
    await expect(omieRequest("/geral/clientes/", "ListarClientes", [{}])).rejects.toThrow(/OMIE_APP_KEY/);
    expect(mockFetch).not.toHaveBeenCalled();

    process.env.OMIE_APP_KEY = prevKey;
    process.env.OMIE_APP_SECRET = prevSecret;
  });
});

describe("validateArgs — scalar types and enums", () => {
  it("rejects a string where a number is declared", async () => {
    const { validateArgs } = await import("../omie.js");
    const errors = validateArgs({ type: "object", properties: { n: { type: "number" } } }, { n: "5" });
    expect(errors).toEqual(["n must be a number"]);
  });

  it("rejects a value outside the declared enum", async () => {
    const { validateArgs } = await import("../omie.js");
    const schema = { type: "object", properties: { tipo: { type: "string", enum: ["ENT", "SAI"] } } };
    const errors = validateArgs(schema, { tipo: "ent" });
    expect(errors[0]).toContain("must be one of: ENT, SAI");
  });

  it("rejects a page size over a declared maximum", async () => {
    const { validateArgs } = await import("../omie.js");
    const schema = { type: "object", properties: { registros_por_pagina: { type: "number", maximum: 100 } } };
    const errors = validateArgs(schema, { registros_por_pagina: 500 });
    expect(errors[0]).toContain("must be at most 100");
  });

  it("rejects a boolean-typed field given a non-boolean", async () => {
    const { validateArgs } = await import("../omie.js");
    const errors = validateArgs({ type: "object", properties: { b: { type: "boolean" } } }, { b: "true" });
    expect(errors).toEqual(["b must be a boolean"]);
  });

  it("still accepts a valid value against the same schema", async () => {
    const { validateArgs } = await import("../omie.js");
    const schema = { type: "object", properties: { tipo: { type: "string", enum: ["ENT", "SAI"] }, n: { type: "number", maximum: 100 } } };
    expect(validateArgs(schema, { tipo: "ENT", n: 50 })).toEqual([]);
  });
});

describe("validateArgs — anyOfRequired", () => {
  const schema = {
    type: "object",
    properties: { codigo_produto: { type: "number" }, codigo_produto_integracao: { type: "string" } },
    anyOfRequired: ["codigo_produto", "codigo_produto_integracao"],
  };

  it("rejects an object with none of the alternative identifying fields", async () => {
    const { validateArgs } = await import("../omie.js");
    const errors = validateArgs(schema, {});
    expect(errors).toEqual([
      "arguments must include at least one of: codigo_produto, codigo_produto_integracao",
    ]);
  });

  it("accepts either alternative on its own", async () => {
    const { validateArgs } = await import("../omie.js");
    expect(validateArgs(schema, { codigo_produto: 1 })).toEqual([]);
    expect(validateArgs(schema, { codigo_produto_integracao: "SKU-1" })).toEqual([]);
  });

  it("accepts both alternatives given together — this is 'at least one', not exactly one", async () => {
    const { validateArgs } = await import("../omie.js");
    expect(validateArgs(schema, { codigo_produto: 1, codigo_produto_integracao: "SKU-1" })).toEqual([]);
  });

  it("reports the anyOfRequired violation alongside an unrelated required-field violation", async () => {
    const { validateArgs } = await import("../omie.js");
    const combined = { ...schema, required: ["quantidade"] };
    const errors = validateArgs(combined, {});
    expect(errors).toContain("quantidade is required");
    expect(errors).toContain(
      "arguments must include at least one of: codigo_produto, codigo_produto_integracao"
    );
  });

  it("applies at whatever nesting level the object schema appears", async () => {
    const { validateArgs } = await import("../omie.js");
    const nested = { type: "object", properties: { produto: schema } };
    const errors = validateArgs(nested, { produto: {} });
    expect(errors).toEqual([
      "produto must include at least one of: codigo_produto, codigo_produto_integracao",
    ]);
  });

  it("ignores anyOfRequired when it isn't declared, as before this feature existed", async () => {
    const { validateArgs } = await import("../omie.js");
    expect(validateArgs({ type: "object", properties: { a: { type: "number" } } }, {})).toEqual([]);
  });
});
