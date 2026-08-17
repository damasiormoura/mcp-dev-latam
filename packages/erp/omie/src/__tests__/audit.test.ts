import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOLS } from "../tools/index.js";
import {
  type Caller,
  buildEntry,
  callerLabel,
  currentCaller,
  identified,
  notes,
  stamp,
  stampText,
  withCaller,
} from "../audit.js";

/**
 * Audit trail tests.
 *
 * Two properties matter here and they pull in opposite directions:
 *
 *   - The trail must be complete. Every call, including the rejected ones,
 *     must name whoever made it.
 *   - Recording it must never damage what it records. The stamp writes into a
 *     live ERP, so the cases that must NOT stamp are tested as carefully as
 *     the ones that must — an update that blanks a record's existing notes to
 *     leave an audit note is a worse outcome than no note at all.
 */

const RODRIGO: Caller = { sub: "u-1", email: "rodrigo@example.com", username: "rodrigo" };
const AT = new Date("2026-08-16T10:32:45.000Z");

describe("caller context", () => {
  it("carries identity across async boundaries", async () => {
    const seen = await withCaller(RODRIGO, async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      // Two awaits deep is the shape of the real path: the HTTP handler awaits
      // the transport, which awaits the tool handler.
      return currentCaller();
    });

    expect(seen).toEqual(RODRIGO);
  });

  it("keeps concurrent callers separate", async () => {
    const [a, b] = await Promise.all([
      withCaller({ email: "a@example.com" }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return callerLabel(currentCaller());
      }),
      withCaller({ email: "b@example.com" }, async () => {
        return callerLabel(currentCaller());
      }),
    ]);

    expect(a).toBe("a@example.com");
    expect(b).toBe("b@example.com");
  });

  it("reports no caller outside a context", () => {
    expect(currentCaller()).toBeUndefined();
    expect(callerLabel(undefined)).toBe("unauthenticated");
  });

  it("distinguishes a context with no identity from an identified one", () => {
    // What the HTTP layer produces when enforcement is off: a session to
    // correlate by, but nobody to name.
    expect(identified({ sessionId: "s-1" })).toBe(false);
    expect(callerLabel({ sessionId: "s-1" })).toBe("unauthenticated");
    expect(identified(RODRIGO)).toBe(true);
  });

  it("falls back through email, username, then subject", () => {
    expect(callerLabel({ sub: "u-1", username: "r", email: "e@x.com" })).toBe("e@x.com");
    expect(callerLabel({ sub: "u-1", username: "r" })).toBe("r");
    expect(callerLabel({ sub: "u-1" })).toBe("u-1");
  });
});

describe("audit entries", () => {
  it("summarises identifying and monetary fields, not the whole payload", () => {
    const entry = buildEntry({
      caller: RODRIGO,
      tool: "pay_account_payable",
      path: "/financas/contapagar/",
      call: "LancarPagamento",
      outcome: "ok",
      durationMs: 12,
      args: {
        codigo_lancamento: 3001,
        valor: 1500.5,
        data: "16/08/2026",
        observacao: "some free text that is not an identifier",
      },
    });

    expect(entry.actor).toBe("rodrigo@example.com");
    expect(entry.args).toEqual({ codigo_lancamento: 3001, valor: 1500.5 });
    // The note body is business text, not an identifier — deliberately absent.
    expect(JSON.stringify(entry.args)).not.toContain("free text");
  });

  it("reaches identifiers nested inside the Omie request blocks", () => {
    const entry = buildEntry({
      caller: RODRIGO,
      tool: "create_order",
      path: "/produtos/pedido/",
      call: "IncluirPedido",
      outcome: "ok",
      durationMs: 30,
      args: {
        cabecalho: { codigo_cliente: 1001, codigo_pedido_integracao: "PED-1" },
        det: [{ produto: { codigo_produto: 2001, quantidade: 3, valor_unitario: 50 } }],
      },
    });

    expect(entry.args).toMatchObject({
      "cabecalho.codigo_cliente": 1001,
      "cabecalho.codigo_pedido_integracao": "PED-1",
      "det.0.produto.codigo_produto": 2001,
    });
  });

  it("leaves tax IDs out of the default summary", () => {
    const entry = buildEntry({
      caller: RODRIGO,
      tool: "create_customer",
      path: "/geral/clientes/",
      call: "IncluirCliente",
      outcome: "ok",
      durationMs: 20,
      args: { cnpj_cpf: "12345678000190", razao_social: "Demo LTDA", codigo_cliente_integracao: "CLI-1" },
      result: { codigo_cliente: 1001 },
    });

    // The response ID already points at the exact record; the registration data
    // of the person it is about does not need to accumulate in an access log.
    expect(JSON.stringify(entry.args)).not.toContain("12345678000190");
    expect(entry.args).toEqual({ codigo_cliente_integracao: "CLI-1" });
    expect(entry.result).toEqual({ codigo_cliente: 1001 });
  });

  it("records the Omie IDs a write returned, which is the link to the ERP record", () => {
    const entry = buildEntry({
      caller: RODRIGO,
      tool: "create_order",
      path: "/produtos/pedido/",
      call: "IncluirPedido",
      outcome: "ok",
      durationMs: 40,
      result: { codigo_pedido: 12345, codigo_status: "0", descricao_status: "Processo executado com sucesso." },
    });

    expect(entry.result).toMatchObject({ codigo_pedido: 12345, codigo_status: "0" });
    expect(entry.result).not.toHaveProperty("descricao_status");
  });

  it("names the caller as unauthenticated rather than omitting the field", () => {
    const entry = buildEntry({
      caller: undefined,
      tool: "list_customers",
      path: "/geral/clientes/",
      call: "ListarClientes",
      outcome: "ok",
      durationMs: 5,
    });

    expect(entry.caller).toBeNull();
    expect(entry.actor).toBe("unauthenticated");
  });
});

describe("attribution stamp", () => {
  const CREATE = notes("always", "observacoes", "obs_venda");
  const UPDATE = notes("if-present", "observacoes", "obs_venda");

  it("is ASCII-only and carries who and when", () => {
    const text = stampText(RODRIGO, AT);
    expect(text).toBe("[via MCP: rodrigo@example.com at 2026-08-16 10:32Z]");
    // These strings can reach fiscal documents; the encoding path there is not
    // ours to assume.
    expect(/^[\x20-\x7E]*$/.test(text)).toBe(true);
  });

  it("creates the notes block on a create when the caller sent none", () => {
    const { param, stamped } = stamp({ cabecalho: { codigo_cliente: 1 } }, CREATE, RODRIGO, AT);

    expect(stamped).toBe(true);
    expect((param as any).observacoes.obs_venda).toBe(stampText(RODRIGO, AT));
    expect((param as any).cabecalho).toEqual({ codigo_cliente: 1 });
  });

  it("appends to the caller's own note instead of replacing it", () => {
    const { param, stamped } = stamp(
      { observacoes: { obs_venda: "Pedido urgente" } },
      CREATE,
      RODRIGO,
      AT
    );

    expect(stamped).toBe(true);
    expect((param as any).observacoes.obs_venda).toBe(`Pedido urgente ${stampText(RODRIGO, AT)}`);
  });

  it("leaves an update alone when the caller did not send the notes field", () => {
    // The load-bearing case: AlterarPedidoVenda writes what it is sent, so
    // creating the field here would erase the order's existing notes.
    const original = { cabecalho: { codigo_pedido: 1 } };
    const { param, stamped } = stamp(original, UPDATE, RODRIGO, AT);

    expect(stamped).toBe(false);
    expect(param).toBe(original);
    expect(param).not.toHaveProperty("observacoes");
  });

  it("appends on an update when the caller is already rewriting the notes", () => {
    const { param, stamped } = stamp(
      { cabecalho: { codigo_pedido: 1 }, observacoes: { obs_venda: "Revisado" } },
      UPDATE,
      RODRIGO,
      AT
    );

    expect(stamped).toBe(true);
    expect((param as any).observacoes.obs_venda).toBe(`Revisado ${stampText(RODRIGO, AT)}`);
  });

  it("never mutates the object it was given", () => {
    const original = { observacoes: { obs_venda: "original" } };
    const snapshot = structuredClone(original);
    stamp(original, CREATE, RODRIGO, AT);

    expect(original).toEqual(snapshot);
  });

  it("does nothing without a verified identity", () => {
    expect(stamp({}, CREATE, undefined, AT).stamped).toBe(false);
    // A session with no identity behind it must not become a name in the ERP.
    expect(stamp({}, CREATE, { sessionId: "s-1" }, AT).stamped).toBe(false);
  });

  it("does nothing for a tool that declares no notes field", () => {
    expect(stamp({ codigo_cliente: 1 }, undefined, RODRIGO, AT).stamped).toBe(false);
  });

  it("skips rather than risk pushing a long note past an unknown field limit", () => {
    const long = "x".repeat(600);
    const { param, stamped } = stamp({ observacoes: { obs_venda: long } }, CREATE, RODRIGO, AT);

    expect(stamped).toBe(false);
    expect((param as any).observacoes.obs_venda).toBe(long);
  });

  it("leaves the payload alone when the notes path holds something unexpected", () => {
    const original = { observacoes: "not an object" };
    expect(stamp(original, CREATE, RODRIGO, AT)).toEqual({ param: original, stamped: false });

    const wrongLeaf = { observacoes: { obs_venda: 42 } };
    expect(stamp(wrongLeaf, CREATE, RODRIGO, AT).stamped).toBe(false);
  });

  it("folds a non-ASCII identity rather than writing it into a fiscal field", () => {
    // The label comes from the IdP's directory, so it is whatever is stored
    // there. The claim that the stamp is ASCII has to hold for those too.
    const text = stampText({ email: "joão.conceição@exemplo.com.br" }, AT);

    expect(text).toBe("[via MCP: joao.conceicao@exemplo.com.br at 2026-08-16 10:32Z]");
    expect(/^[\x20-\x7E]*$/.test(text)).toBe(true);
  });

  it("drops characters that have no ASCII fold at all", () => {
    const text = stampText({ username: "мария✨" }, AT);
    expect(/^[\x20-\x7E]*$/.test(text)).toBe(true);
    expect(text).toContain("[via MCP:");
  });

  describe("if-parent-present", () => {
    // For a block that carries business fields of its own, conjuring it to
    // hold a note would change the request Omie receives.
    const TARGET = notes("if-parent-present", "detalhes", "cObs");

    it("writes the note when the block is already there", () => {
      const { param, stamped } = stamp(
        { cCodIntLanc: "CC-1", detalhes: { cCodCateg: "2.04.01" } },
        TARGET,
        RODRIGO,
        AT
      );

      expect(stamped).toBe(true);
      expect((param as any).detalhes).toEqual({ cCodCateg: "2.04.01", cObs: stampText(RODRIGO, AT) });
    });

    it("does not invent the block when the caller omitted it", () => {
      const original = { cCodIntLanc: "CC-1", cabecalho: { nCodCC: 1 } };
      const { param, stamped } = stamp(original, TARGET, RODRIGO, AT);

      expect(stamped).toBe(false);
      expect(param).toBe(original);
      expect(param).not.toHaveProperty("detalhes");
    });

    it("still appends to a note the caller wrote", () => {
      const { param } = stamp({ detalhes: { cObs: "Taxa bancária" } }, TARGET, RODRIGO, AT);
      expect((param as any).detalhes.cObs).toBe(`Taxa bancária ${stampText(RODRIGO, AT)}`);
    });
  });

  it("stamps a top-level notes field", () => {
    const { param, stamped } = stamp({ obs: "Ajuste inventário" }, notes("always", "obs"), RODRIGO, AT);

    expect(stamped).toBe(true);
    expect((param as any).obs).toBe(`Ajuste inventário ${stampText(RODRIGO, AT)}`);
  });
});

describe("MCP_AUDIT_STAMP=false", () => {
  const original = process.env.MCP_AUDIT_STAMP;
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    if (original === undefined) delete process.env.MCP_AUDIT_STAMP;
    else process.env.MCP_AUDIT_STAMP = original;
  });

  it("turns the ERP-side stamp off while leaving the log intact", async () => {
    process.env.MCP_AUDIT_STAMP = "false";
    // vi.resetModules() above dropped the registry entry, so this re-evaluates
    // the module and re-reads the switch rather than handing back the instance
    // the static import at the top of this file is bound to.
    const fresh = await import("../audit.js");

    const result = fresh.stamp({ observacoes: {} }, fresh.notes("always", "observacoes", "obs_venda"), RODRIGO, AT);
    expect(result.stamped).toBe(false);

    // The log is a separate mechanism and is not affected by the switch.
    const entry = fresh.buildEntry({
      caller: RODRIGO, tool: "create_order", path: "/produtos/pedido/",
      call: "IncluirPedido", outcome: "ok", durationMs: 1,
    });
    expect(entry.actor).toBe("rodrigo@example.com");
  });
});

/**
 * Rotation, against a real file. `logrotate` renames the current file out from
 * under the process's open descriptor and expects a signal handler to reopen
 * at the same path — this reproduces exactly that sequence, without a signal
 * or a subprocess, so it can assert on the two files directly.
 */
describe("log rotation (reopenAuditLog)", () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-omie-audit-"));
  const logPath = join(dir, "audit.jsonl");
  const originalEnv = process.env.MCP_AUDIT_LOG;

  beforeEach(() => {
    vi.resetModules();
    process.env.MCP_AUDIT_LOG = logPath;
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MCP_AUDIT_LOG;
    else process.env.MCP_AUDIT_LOG = originalEnv;
  });

  const entry = (n: number) =>
    buildEntry({ caller: RODRIGO, tool: `tool-${n}`, path: "/x/", call: "X", outcome: "ok", durationMs: 0 });

  it("writes new entries to a freshly created file after the old one is renamed away", async () => {
    const fresh = await import("../audit.js");

    fresh.record(entry(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(readFileSync(logPath, "utf8").trim().split("\n")).toHaveLength(1);

    // The rotation itself: rename the live file out from under the open fd,
    // exactly what logrotate's `postrotate` step follows with a signal for.
    const rotated = `${logPath}.1`;
    renameSync(logPath, rotated);

    fresh.reopenAuditLog();
    await new Promise((r) => setTimeout(r, 20));
    fresh.record(entry(2));
    await new Promise((r) => setTimeout(r, 20));

    // Without the reopen, this second entry would land in the renamed file
    // (the fd would still point at it) and the configured path would stay
    // empty until the next restart — which is the whole failure this exists
    // to prevent.
    expect(readFileSync(logPath, "utf8").trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(readFileSync(logPath, "utf8").trim())).toMatchObject({ tool: "tool-2" });
    expect(JSON.parse(readFileSync(rotated, "utf8").trim())).toMatchObject({ tool: "tool-1" });
  });

  it("gives a previously failed sink another chance at the same path", async () => {
    // The path's parent directory does not exist yet — the same failure class
    // as a volume that is briefly unmounted or full: the configured path is
    // momentarily unwritable through no fault of the application.
    const missingParent = join(dir, "not-yet-mounted", "audit.jsonl");
    process.env.MCP_AUDIT_LOG = missingParent;
    const fresh = await import("../audit.js");

    fresh.record(entry(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(existsSync(missingParent)).toBe(false);

    // The underlying problem resolves — the directory shows up — and SIGHUP
    // gives the sink another chance without a container restart. `streamFailed`
    // must not be sticky for the life of the process once that happens.
    mkdirSync(join(dir, "not-yet-mounted"));
    fresh.reopenAuditLog();
    fresh.record(entry(2));
    await new Promise((r) => setTimeout(r, 20));

    expect(existsSync(missingParent)).toBe(true);
    expect(JSON.parse(readFileSync(missingParent, "utf8").trim())).toMatchObject({ tool: "tool-2" });
  });
});

/**
 * A misspelled notes path would fail silently — nothing stamped, and no error
 * to notice — or worse, send Omie a field it does not accept. Both are the
 * defect class the contract test exists for, so the same rule applies: the
 * declared path must resolve against the tool's own schema.
 */
describe("declared notes paths resolve against the tool schema", () => {
  const withNotes = TOOLS.filter((t) => t.notes);

  it("covers the write tools that have a notes field", () => {
    expect(withNotes.length).toBeGreaterThanOrEqual(15);
  });

  it.each(withNotes.map((t) => [t.name, t] as const))("%s", (_name, tool) => {
    let node: any = tool.inputSchema;
    for (const segment of tool.notes!.path) {
      const properties = node?.properties ?? {};
      expect(
        properties[segment],
        `${tool.name}: notes path "${tool.notes!.path.join(".")}" breaks at "${segment}" — ` +
          `not a declared property, so it would be sent to ${tool.call} as an unknown field`
      ).toBeDefined();
      node = properties[segment];
    }
    // The leaf has to be free text; stamping a number or an object is nonsense.
    expect(node.type, `${tool.name}: notes leaf must be a string`).toBe("string");
  });

  it("only stamps writes — a read has nothing to attribute", () => {
    const reads = withNotes.filter((t) => /^(Listar|Consultar|Obter|Pesquisar|Status|Simular|Validar|Posicao)/.test(t.call));
    expect(reads.map((t) => t.name)).toEqual([]);
  });

  it("uses if-present on every Alterar/Upsert method, which overwrite what they are sent", () => {
    const rewriting = withNotes.filter((t) => /^(Alterar|Upsert)/.test(t.call));
    expect(rewriting.length).toBeGreaterThan(0);
    for (const tool of rewriting) {
      expect(
        tool.notes!.when,
        `${tool.name} (${tool.call}) must use if-present: creating the notes field on an ` +
          `update would replace whatever the record already had`
      ).toBe("if-present");
    }
  });

  /**
   * "always" is the only mode that can bring a block into existence, so it is
   * only safe where doing so cannot change what the request means: either the
   * block is required anyway, or it holds nothing besides the note.
   */
  it("only uses always where creating the enclosing block is harmless", () => {
    const nested = withNotes.filter((t) => t.notes!.when === "always" && t.notes!.path.length > 1);

    for (const tool of nested) {
      const [block] = tool.notes!.path;
      const schema = tool.inputSchema as any;
      const required: string[] = schema.required ?? [];
      const siblings = Object.keys(schema.properties[block].properties ?? {});

      expect(
        required.includes(block) || siblings.length === 1,
        `${tool.name}: "${block}" is optional and carries ${siblings.join(", ")} — creating it ` +
          `just to hold a note would send ${tool.call} a different request shape. Use if-parent-present.`
      ).toBe(true);
    }
  });
});
