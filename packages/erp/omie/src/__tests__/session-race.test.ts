import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * The real server on a real port: express, the SDK's Streamable HTTP
 * transport and the tool handlers, with only Omie replaced. The other tests of
 * the HTTP path mock the transport, so none of them could see what happened
 * in production on 2026-10-05 at 18:34 UTC.
 *
 * Claude Code reaches this server through Anthropic's MCP proxy. After a
 * session expiry it opened two connections within two seconds, each numbering
 * its JSON-RPC requests from zero, and the proxy carried both into the same
 * session here. The SDK transport finds the HTTP response for a result by the
 * request's id alone, so a request that arrived while an earlier one with the
 * same id was still running took over that one's response: the agent asked
 * for OS 5975012350 and got OS 5975011809, and asked for a sales order and got
 * an OS. The audit log shows every call executed with its own arguments; the
 * swap was in delivery.
 */

// Omie, answering each record with its own ID. OS 23 answers at once, as #2
// had in production before the second connection's requests arrived; the
// rest take long enough to still be running then.
const OS_NUMBER: Record<number, string> = { 5975011809: "38", 5963738552: "23", 5975012350: "40", 5975012630: "41", 5975012079: "39" };
const omieCalls: Array<{ call: string; id: number }> = [];
const realFetch = globalThis.fetch;

async function fakeOmie(init: RequestInit): Promise<Response> {
  const { call, param: [p] } = JSON.parse(String(init.body));
  const id = call === "ConsultarOS" ? p.nCodOS : p.codigo_pedido;
  omieCalls.push({ call, id });
  await new Promise((r) => setTimeout(r, id === 5963738552 ? 20 : 900));
  const body = call === "ConsultarOS"
    ? { Cabecalho: { nCodOS: id, cNumOS: OS_NUMBER[id] } }
    : { pedido_venda_produto: { cabecalho: { codigo_pedido: id } } };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

let url: string;
let stderr: ReturnType<typeof vi.spyOn>;

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const { port } = probe.address() as { port: number };
  await new Promise((r) => probe.close(r));
  return port;
}

beforeAll(async () => {
  stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  const port = await freePort();
  url = `http://127.0.0.1:${port}/mcp`;
  Object.assign(process.env, { MCP_HTTP: "true", MCP_INSECURE_HTTP: "true", MCP_PORT: String(port), OMIE_APP_KEY: "k", OMIE_APP_SECRET: "s" });
  globalThis.fetch = ((input: any, init?: RequestInit) =>
    String(input).startsWith("https://app.omie.com.br/") ? fakeOmie(init!) : realFetch(input, init)) as typeof fetch;
  await import("../index.js");
  await vi.waitFor(async () => expect((await realFetch(url.replace("/mcp", "/health"))).ok).toBe(true));
});

afterAll(() => {
  globalThis.fetch = realFetch;
  for (const k of ["MCP_HTTP", "MCP_INSECURE_HTTP", "MCP_PORT", "OMIE_APP_KEY", "OMIE_APP_SECRET"]) delete process.env[k];
});

type Posted = { status: number; messages: any[]; sid: string | null };

/** One POST, read to the end; an SSE body is split into its JSON-RPC messages. */
async function post(body: unknown, sid?: string, protocolVersion = "2025-06-18"): Promise<Posted> {
  const res = await realFetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sid ? { "mcp-session-id": sid, "mcp-protocol-version": protocolVersion } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const messages = (res.headers.get("content-type") ?? "").includes("text/event-stream")
    ? text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)))
    : text ? [JSON.parse(text)] : [];
  return { status: res.status, messages, sid: res.headers.get("mcp-session-id") };
}

async function openSession(): Promise<string> {
  const init = await post({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "race", version: "1" } } });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }, init.sid!);
  return init.sid!;
}

const os = (nCodOS: number) => ({ name: "get_service_order", arguments: { nCodOS } });
const order = (codigo_pedido: number) => ({ name: "get_sales_order", arguments: { codigo_pedido } });
const call = (id: number, params: unknown) => ({ jsonrpc: "2.0", id, method: "tools/call", params });
const askedId = (params: any): number => params.arguments.nCodOS ?? params.arguments.codigo_pedido;

/** The record a tool result is about, read from the body Omie returned. */
function answeredId(result: any): number {
  const r = JSON.parse(result.content[0].text);
  return r.Cabecalho?.nCodOS ?? r.pedido_venda_produto.cabecalho.codigo_pedido;
}

/** What one POST got back for the request it carried: the record, a refusal, or nothing. */
function outcome(r: Posted | "no answer", id: number): number | "refused" | "no answer" {
  if (r === "no answer") return r;
  if (r.status === 409) return "refused";
  return answeredId(r.messages.find((m) => m.id === id).result);
}

/** Waits for a POST, but not forever: a response whose result went to another POST never ends. */
const within = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<"no answer">((r) => setTimeout(() => r("no answer"), ms))]);

const audits = () =>
  stderr.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("AUDIT ")).map((l) => JSON.parse(l.slice(6)));

describe("two client connections in one session (production, 2026-10-05 18:34 UTC)", () => {
  it("never delivers one call's result to another, and refuses an id still being answered", async () => {
    const sid = await openSession();
    omieCalls.length = 0;

    // Connection 1: the six calls, as the agent sent them (#1 … #6).
    const first = [os(5975011809), os(5963738552), os(5975012350), os(5975012630), os(5975012079), order(5975559754)];
    const firstWave = first.map((p, i) => post(call(2 + i, p), sid));
    await new Promise((r) => setTimeout(r, 400));

    // Connection 2: numbered from the same starting point, retrying #3 … #6.
    // Its ids 2, 4 and 5 are still being answered on connection 1; id 3 (#2) is not.
    const second = [os(5975012350), os(5975012630), os(5975012079), order(5975559754)];
    const secondWave = await Promise.all(second.map((p, i) => within(post(call(2 + i, p), sid), 3000)));

    // Before the fix this read [5975011809, 5975012630, 5975012350, 5975012630]:
    // #3 got #1's OS, #5 got #3's, and the sales order request got #4's OS.
    expect(secondWave.map((r, i) => ({ asked: askedId(second[i]), got: outcome(r, 2 + i) }))).toEqual([
      { asked: 5975012350, got: "refused" },
      { asked: 5975012630, got: 5975012630 },
      { asked: 5975012079, got: "refused" },
      { asked: 5975559754, got: "refused" },
    ]);
    const refusal = (secondWave[0] as Posted).messages[0];
    expect(refusal.id).toBeNull();
    expect(refusal.error.message).toContain("request id 2 is still being answered in this session");
    expect(refusal.error.message).toContain("Nothing was executed");

    // Connection 1 gets every one of its own results.
    const firstResults = await Promise.all(firstWave.map((p) => within(p, 3000)));
    expect(firstResults.map((r, i) => outcome(r, 2 + i))).toEqual(first.map(askedId));

    // A refused request never reached Omie, and left a line in the audit trail.
    expect(omieCalls).toHaveLength(7);
    expect(audits().filter((e) => e.outcome === "denied").map((e) => [e.tool, e.args, e.error])).toEqual([
      ["get_service_order", { nCodOS: 5975012350 }, "request id 2 reused while still being answered"],
      ["get_service_order", { nCodOS: 5975012079 }, "request id 4 reused while still being answered"],
      ["get_sales_order", { codigo_pedido: 5975559754 }, "request id 5 reused while still being answered"],
    ]);

    // Once answered, an id is free again.
    const retry = await post(call(2, os(5975012350)), sid);
    expect(outcome(retry, 2)).toBe(5975012350);
  });

  it("the same with the official SDK client: a second client in the session fails its colliding call instead of taking the first one's result", async () => {
    const sid = await openSession();

    // Given the session ID, the SDK client skips initialize, as on a reconnect.
    const a = new Client({ name: "conn-1", version: "1" });
    await a.connect(new StreamableHTTPClientTransport(new URL(url), { sessionId: sid }));
    const b = new Client({ name: "conn-2", version: "1" });
    await b.connect(new StreamableHTTPClientTransport(new URL(url), { sessionId: sid }));

    const fromA = within(a.callTool(os(5975011809)), 3000);
    await new Promise((r) => setTimeout(r, 300));
    // Both clients number from 0: b's first request carries the id a is waiting on.
    const fromB = within(b.callTool(os(5975012350)).catch((e: Error) => e), 3000);
    const [resultA, resultB] = await Promise.all([fromA, fromB]);

    // Before the fix: { a: "no answer", b: 5975011809 }.
    const read = (r: unknown) => (r === "no answer" ? r : r instanceof Error ? "refused" : answeredId(r));
    expect({ a: read(resultA), b: read(resultB) }).toEqual({ a: 5975011809, b: "refused" });
    expect((resultB as Error).message).toContain("still being answered in this session");

    // b's next request has a new id and goes through.
    expect(answeredId(await b.callTool(os(5975012350)))).toBe(5975012350);
    await Promise.all([a.close(), b.close()]);
  });

  it("leaves one client's parallel calls alone", async () => {
    const c = new Client({ name: "single", version: "1" });
    await c.connect(new StreamableHTTPClientTransport(new URL(url)));
    const asked = [5975011809, 5963738552, 5975012350, 5975012630, 5975012079];
    const results = await Promise.all(asked.map((id) => c.callTool(os(id))));
    expect(results.map(answeredId)).toEqual(asked);
    await c.close();
  });

  it("refuses an id repeated inside one batch, whatever the method, and records it under the method", async () => {
    const sid = await openSession();
    const r = await post([{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 7, method: "ping" }, { jsonrpc: "2.0", id: 7, method: "ping" }], sid);
    expect(r.status).toBe(409);
    expect(audits().at(-1)).toMatchObject({ tool: "ping", outcome: "denied", error: "request id 7 reused while still being answered" });
    expect(audits().at(-1).args).toBeUndefined();
  });

  it("keeps the ids of a POST the transport turns away: only a sent result frees an id", async () => {
    const sid = await openSession();
    // An unsupported protocol version: the transport answers 400 and runs nothing.
    expect((await post(call(9, os(5975012630)), sid, "1999-01-01")).status).toBe(400);
    expect((await post(call(9, os(5975012630)), sid)).status).toBe(409);
    expect(outcome(await post(call(10, os(5975012630)), sid), 10)).toBe(5975012630);
  });
});
