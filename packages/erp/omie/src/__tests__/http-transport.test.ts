import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

/**
 * The entry point outside the tool handler: startup checks, the stdio and
 * HTTP transports, OAuth token verification, and the per-session bookkeeping.
 * Production reaches every read tool through the HTTP transport, so this is
 * the path a read takes before dispatch. express, jose and the SDK transports
 * are replaced by recorders; the handlers are the real ones from index.ts.
 */

const h = vi.hoisted(() => ({
  routes: {} as Record<string, Function>,
  listen: undefined as undefined | { port: number },
  transports: [] as any[],
  stdioConnected: 0,
  jwtVerify: undefined as any,
  createRemoteJWKSet: undefined as any,
}));

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
  class FakeServer {
    setRequestHandler() {}
    connect(t: any) {
      if (t?.kind === "stdio") h.stdioConnected++;
      return Promise.resolve();
    }
  }
  return { Server: FakeServer };
});
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({ StdioServerTransport: class { kind = "stdio"; } }));
vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: class {
    sessionId?: string;
    onclose?: () => void;
    handled: unknown[] = [];
    closed = 0;
    constructor(public opts: { sessionIdGenerator: () => string; onsessioninitialized: (id: string) => void }) {
      h.transports.push(this);
    }
    async handleRequest(req: any, res: any, body?: unknown) {
      this.handled.push(body ?? req.method);
      if (!this.sessionId && (body as any)?.method === "initialize") {
        this.sessionId = this.opts.sessionIdGenerator();
        this.opts.onsessioninitialized(this.sessionId);
      }
      res.status(200).json({ ok: true, session: this.sessionId });
    }
    close() {
      this.closed++;
      this.onclose?.();
    }
  },
}));
vi.mock("express", () => {
  const app = {
    use: () => {},
    get: (path: string, fn: Function) => { h.routes[`GET ${path}`] = fn; },
    post: (path: string, fn: Function) => { h.routes[`POST ${path}`] = fn; },
    delete: (path: string, fn: Function) => { h.routes[`DELETE ${path}`] = fn; },
    listen: (port: number, cb: () => void) => { h.listen = { port }; cb(); },
  };
  const express: any = () => app;
  express.json = () => "json";
  return { default: express };
});
vi.mock("jose", () => ({
  createRemoteJWKSet: (...a: unknown[]) => h.createRemoteJWKSet(...a),
  jwtVerify: (...a: unknown[]) => h.jwtVerify(...a),
}));

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } };
const ENV_KEYS = ["MCP_HTTP", "MCP_INSECURE_HTTP", "MCP_AUTH_ISSUER", "MCP_AUTH_RESOURCE", "MCP_PORT", "MCP_SESSION_IDLE_TIMEOUT_MS", "MCP_DEMO", "OMIE_APP_KEY", "OMIE_APP_SECRET"];

function res() {
  const r: any = { statusCode: 200, headers: {} as Record<string, string>, body: undefined };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.set = (k: string, v: string) => { r.headers[k] = v; return r; };
  return r;
}
const req = (headers: Record<string, string> = {}, body?: unknown, method = "POST") => ({ headers, body, method });

let stderr: ReturnType<typeof vi.spyOn>;
let exit: MockInstance<typeof process.exit>;
const listeners: Record<string, Function> = {};
const fetchMock = vi.fn();

async function start(env: Record<string, string>, argv: string[] = []) {
  vi.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { OMIE_APP_KEY: "k", OMIE_APP_SECRET: "s" }, env);
  for (const k of Object.keys(env)) if (env[k] === "") delete process.env[k];
  process.argv = ["node", "index.js", ...argv];
  h.routes = {};
  h.listen = undefined;
  h.transports = [];
  h.stdioConnected = 0;
  await import("../index.js");
}

const audits = () =>
  stderr.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("AUDIT ")).map((l) => JSON.parse(l.slice(6)));

const originalArgv = process.argv;
beforeEach(() => {
  stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as any);
  vi.spyOn(process, "once").mockImplementation(((sig: string, fn: Function) => { listeners[sig] = fn; return process; }) as any);
  vi.spyOn(process, "on").mockImplementation(((sig: string, fn: Function) => { listeners[sig] = fn; return process; }) as any);
  fetchMock.mockReset();
  global.fetch = fetchMock as any;
  h.jwtVerify = vi.fn();
  h.createRemoteJWKSet = vi.fn(() => "jwks");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  process.argv = originalArgv;
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("startup", () => {
  it("serves stdio by default", async () => {
    await start({});
    await vi.waitFor(() => expect(h.stdioConnected).toBe(1));
    expect(h.listen).toBeUndefined();
  });

  it("warns, without exiting, when the Omie credentials are missing", async () => {
    await start({ OMIE_APP_KEY: "", OMIE_APP_SECRET: "" });
    await vi.waitFor(() => expect(h.stdioConnected).toBe(1));
    expect(stderr.mock.calls.map((c) => String(c[0])).join("\n")).toContain("OMIE_APP_KEY and/or OMIE_APP_SECRET are not set");
  });

  it("does not warn about credentials in demo mode", async () => {
    await start({ OMIE_APP_KEY: "", OMIE_APP_SECRET: "", MCP_DEMO: "true" });
    await vi.waitFor(() => expect(h.stdioConnected).toBe(1));
    expect(stderr.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("are not set");
  });

  it("refuses to start HTTP with no authentication unless told the port is private", async () => {
    await start({ MCP_HTTP: "true" });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    const out = stderr.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("Refusing to start the HTTP transport without authentication");
    // main() rejecting (here: the mocked exit throwing) is reported, not left unhandled.
    await vi.waitFor(() => expect(stderr.mock.calls.some((c) => c[0] instanceof Error && /exit 1/.test(c[0].message))).toBe(true));
    expect(h.listen).toBeUndefined();
  });

  it("--http with MCP_INSECURE_HTTP listens on MCP_PORT and says auth is off", async () => {
    await start({ MCP_INSECURE_HTTP: "true", MCP_PORT: "4123" }, ["--http"]);
    await vi.waitFor(() => expect(h.listen).toEqual({ port: 4123 }));
    const out = stderr.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("MCP HTTP server on http://localhost:4123/mcp");
    expect(out).toContain("Auth: DISABLED");
    // No protected-resource metadata without an issuer.
    expect(h.routes["GET /.well-known/oauth-protected-resource"]).toBeUndefined();
  });
});

describe("HTTP transport without auth (MCP_INSECURE_HTTP)", () => {
  beforeEach(async () => {
    await start({ MCP_HTTP: "true", MCP_INSECURE_HTTP: "true" });
    await vi.waitFor(() => expect(h.listen).toEqual({ port: 3000 }));
  });

  it("answers the health check with the session count", async () => {
    const r = res();
    h.routes["GET /health"]({}, r);
    expect(r.body).toEqual({ status: "ok", sessions: 0 });
  });

  it("opens a session on initialize, then routes POST / GET / DELETE to it", async () => {
    const init = res();
    await h.routes["POST /mcp"](req({}, INIT), init);
    const sid = init.body.session;
    expect(sid).toMatch(/[0-9a-f-]{36}/);
    const [t] = h.transports;

    await h.routes["POST /mcp"](req({ "mcp-session-id": sid }, { jsonrpc: "2.0", id: 2, method: "tools/list" }), res());
    await h.routes["GET /mcp"](req({ "mcp-session-id": sid }, undefined, "GET"), res());
    await h.routes["DELETE /mcp"](req({ "mcp-session-id": sid }, undefined, "DELETE"), res());
    expect(t.handled).toEqual([INIT, { jsonrpc: "2.0", id: 2, method: "tools/list" }, "GET", "DELETE"]);

    const health = res();
    h.routes["GET /health"]({}, health);
    expect(health.body.sessions).toBe(1);
  });

  it("answers 404 to an unknown session on every verb, so the client re-initializes", async () => {
    for (const verb of ["POST", "GET", "DELETE"]) {
      const r = res();
      await h.routes[`${verb} /mcp`](req({ "mcp-session-id": "gone" }, {}), r);
      expect(r.statusCode, verb).toBe(404);
      expect(r.body.error.message).toBe("Session not found");
    }
  });

  it("answers 400 to a non-initialize request with no session", async () => {
    const r = res();
    await h.routes["POST /mcp"](req({}, { jsonrpc: "2.0", id: 1, method: "tools/list" }), r);
    expect(r.statusCode).toBe(400);
  });

  it("forgets a session when its transport closes, and ignores a close before initialization", async () => {
    await h.routes["POST /mcp"](req({}, INIT), res());
    const [t] = h.transports;
    t.close();
    const r = res();
    await h.routes["GET /mcp"](req({ "mcp-session-id": t.sessionId }, undefined, "GET"), r);
    expect(r.statusCode).toBe(404);

    // A transport that closes before it ever got a session ID has nothing to remove.
    await h.routes["POST /mcp"](req({}, { ...INIT, method: "initialize" }), res());
    const second = h.transports[1];
    second.sessionId = undefined;
    expect(() => second.onclose()).not.toThrow();
  });

  it("flushes the audit log and exits on SIGTERM / SIGINT, and reopens it on SIGHUP", async () => {
    expect(() => listeners.SIGTERM()).toThrow("exit 0");
    expect(() => listeners.SIGINT()).toThrow("exit 0");
    listeners.SIGHUP();
    expect(stderr.mock.calls.map((c) => String(c[0]))).toContain("Audit log reopened (SIGHUP) for log rotation.");
  });
});

describe("idle session sweep", () => {
  it("closes and drops a session idle longer than MCP_SESSION_IDLE_TIMEOUT_MS", async () => {
    vi.useFakeTimers();
    await start({ MCP_HTTP: "true", MCP_INSECURE_HTTP: "true", MCP_SESSION_IDLE_TIMEOUT_MS: "90000" });
    await vi.waitFor(() => expect(h.listen).toBeDefined());
    await h.routes["POST /mcp"](req({}, INIT), res());
    const [idle] = h.transports;
    await h.routes["POST /mcp"](req({}, INIT), res());
    const [, busy] = h.transports;

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    // Activity keeps a session alive: touch() refreshes lastSeenAt.
    await h.routes["GET /mcp"](req({ "mcp-session-id": busy.sessionId }, undefined, "GET"), res());
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(idle.closed).toBe(1);
    expect(busy.closed).toBe(0);
    const r = res();
    await h.routes["GET /mcp"](req({ "mcp-session-id": idle.sessionId }, undefined, "GET"), r);
    expect(r.statusCode).toBe(404);
  });
});

describe("HTTP transport with OAuth", () => {
  const ISSUER = "https://idp.example.com/realms/mcp";
  const RESOURCE = "https://mcp.example.com/mcp";

  beforeEach(async () => {
    await start({ MCP_HTTP: "true", MCP_AUTH_ISSUER: ISSUER, MCP_AUTH_RESOURCE: RESOURCE });
    await vi.waitFor(() => expect(h.listen).toBeDefined());
  });

  const discovery = (body: unknown, ok = true) =>
    fetchMock.mockResolvedValueOnce({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });

  it("says auth is on, and serves protected-resource metadata at both paths", async () => {
    expect(stderr.mock.calls.map((c) => String(c[0])).join("\n")).toContain(`Auth: OAuth bearer required (issuer ${ISSUER}, audience ${RESOURCE})`);
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/{*path}"]) {
      const r = res();
      h.routes[`GET ${path}`]({}, r);
      expect(r.body).toEqual({ resource: RESOURCE, authorization_servers: [ISSUER], bearer_methods_supported: ["header"] });
    }
  });

  it("answers 401 with the metadata pointer when there is no bearer token", async () => {
    for (const [verb, headers] of [["POST", {}], ["POST", { authorization: "Basic abc" }], ["GET", {}], ["DELETE", {}]] as const) {
      const r = res();
      await h.routes[`${verb} /mcp`](req(headers, INIT, verb), r);
      expect(r.statusCode, verb).toBe(401);
      expect(r.headers["WWW-Authenticate"]).toBe('Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"');
      expect(r.body.error.message).toBe("Authentication required");
    }
    expect(h.transports).toHaveLength(0);
  });

  it("answers 401 invalid_token when discovery fails, has no jwks_uri, or the token does not verify", async () => {
    const attempt = async () => {
      const r = res();
      await h.routes["GET /mcp"](req({ authorization: "Bearer t", "mcp-session-id": "x" }, undefined, "GET"), r);
      return r;
    };
    discovery({}, false);
    expect((await attempt()).body.error.message).toBe("OIDC discovery failed: HTTP 500");
    discovery({});
    expect((await attempt()).body.error.message).toBe("OIDC discovery document has no jwks_uri");

    discovery({ jwks_uri: `${ISSUER}/certs` });
    h.jwtVerify.mockRejectedValueOnce(new Error("signature verification failed"));
    const bad = await attempt();
    expect(bad.statusCode).toBe(401);
    expect(bad.headers["WWW-Authenticate"]).toContain('error="invalid_token", error_description="signature verification failed"');
    expect(h.createRemoteJWKSet).toHaveBeenCalledWith(new URL(`${ISSUER}/certs`));

    // The key set is cached: no second discovery. A non-Error rejection reads as "Invalid token".
    h.jwtVerify.mockRejectedValueOnce("nope");
    expect((await attempt()).body.error.message).toBe("Invalid token");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("binds a session to the identity that opened it, and refuses — and records — anyone else", async () => {
    discovery({ jwks_uri: `${ISSUER}/certs` });
    h.jwtVerify.mockImplementation(async (token: string) => ({
      payload: token === "alice"
        ? { sub: "u-alice", email: "alice@example.com", preferred_username: "alice" }
        : { sub: "u-bob", email: "", preferred_username: 7 },
    }));
    const opened = res();
    await h.routes["POST /mcp"](req({ authorization: "Bearer alice" }, INIT), opened);
    const sid = opened.body.session;

    const mine = res();
    await h.routes["POST /mcp"](req({ authorization: "Bearer alice", "mcp-session-id": sid }, { jsonrpc: "2.0", id: 2, method: "tools/list" }), mine);
    expect(mine.statusCode).toBe(200);

    for (const [verb, body] of [["POST", { jsonrpc: "2.0", id: 3, method: "tools/call" }], ["GET", undefined], ["DELETE", undefined]] as const) {
      const r = res();
      await h.routes[`${verb} /mcp`](req({ authorization: "Bearer bob", "mcp-session-id": sid }, body, verb), r);
      expect(r.statusCode, verb).toBe(404);
    }
    const denied = audits().filter((e) => e.outcome === "denied");
    expect(denied.map((e) => e.tool)).toEqual(["tools/call", "-", "-"]);
    expect(denied[0]).toMatchObject({ error: "session belongs to another identity", caller: { sub: "u-bob" } });
    // Empty or non-string claims are not taken as an identity.
    expect(denied[0].caller.email).toBeUndefined();
  });
});
