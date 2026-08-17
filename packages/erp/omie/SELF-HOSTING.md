# Self-hosting mcp-omie as a remote MCP server

Notes from putting this server behind OAuth and connecting it to claude.ai as a
custom connector. Written down because several of the steps are non-obvious and
cost real debugging time.

Infrastructure specifics (addresses, container IDs, credentials) deliberately
live outside this repository — this document covers the architecture and the
decisions, not one particular deployment.

## Why any of this is needed

In stdio mode the operating system is the trust boundary: the server runs as a
child process of the client, and nothing else can talk to it. Over HTTP that
boundary disappears. This server exposes `pay_account_payable`,
`invoice_sales_order`, `create_stock_adjustment` and `create_order` against a
live ERP, so an unauthenticated `/mcp` endpoint hands money and inventory to
anyone who can reach it — and a public hostname is found quickly, since
certificate transparency logs index every subdomain a certificate is issued for.

That is why the HTTP transport in this fork refuses to start without
`MCP_AUTH_ISSUER` and `MCP_AUTH_RESOURCE`, unless `MCP_INSECURE_HTTP=true`
says otherwise deliberately.

## Shape of the deployment

```
claude.ai  ──HTTPS──▶  tunnel  ──▶  mcp-omie container   ──▶  app.omie.com.br
    │                                (validates the JWT)
    │
    └──OAuth──────────▶  tunnel  ──▶  Keycloak (IdP)
```

Two public hostnames, both served through the same tunnel:

| Hostname | Origin | Purpose |
|---|---|---|
| `mcp.<domain>` | the MCP container, port 3000 | `/mcp`, `/health`, protected-resource metadata |
| `idp.<domain>` | Keycloak, port 8080 | OIDC discovery, authorization, token, JWKS |

The IdP must be **publicly reachable**, not just reachable from the MCP server.
Discovery and the token exchange are server-to-server calls from Anthropic's
egress range (`160.79.104.0/21` at time of writing), so an IdP that only listens
on the LAN cannot complete the flow.

### A note on tunnel replicas

If the same tunnel token is installed on several hosts, each becomes a replica
and the edge load-balances across all of them. Ingress rules must therefore
point at addresses **every replica can reach** — a LAN address, not `localhost`.
A rule pointing at `localhost:3000` works only when the request happens to land
on the replica that runs the service, producing intermittent 502s that look
like a flaky origin.

## Authentication

Claude's connector infrastructure does not support machine-to-machine
`client_credentials`; every connection requires user consent through an
interactive OAuth flow. Cloudflare Access (or any gateway whose login is a
browser cookie flow) cannot sit in front of the MCP endpoint for the same
reason — the connector is a server-to-server client and cannot complete a
browser login.

Two workable options:

- **Request headers** (`static_headers`) — a fixed API key or bearer token
  entered when adding the connector. Simplest by far, but it is in beta with
  gated access, and header names are restricted to an allowlist, so
  vendor-specific headers may not be usable.
- **OAuth** with `oauth_dcr` or `oauth_cimd` — supported out of the box. What
  this deployment uses.

The MCP server acts as an OAuth **resource server**: it does not implement
login, it only verifies tokens. Three pieces are required, and skipping any one
of them breaks the flow in a way that is hard to read from the client side:

1. `GET /.well-known/oauth-protected-resource` returning `resource` (this
   server's URL, exactly as the user enters it, including the path) and
   `authorization_servers` (the issuer).
2. A **401** carrying `WWW-Authenticate: Bearer resource_metadata="…"` when the
   token is missing or invalid. It must be a 401 — clients ignore the header on
   a 200, and returning a tool-level error looks like a working server that
   simply failed.
3. Per-request verification of the token: signature against the issuer's JWKS,
   plus `iss`, `aud` and expiry. **The `aud` check is the one that matters
   most** — without it, any token the same issuer minted for any other service
   is accepted here.

## Keycloak specifics

These are the parts that cost the most time.

### Dynamic client registration is blocked by default

Keycloak ships anonymous client-registration policies that reject DCR before it
reaches the client. They are evaluated in order and the first failure is the
only one reported, so fixing one surfaces the next — which reads like the fix
did not work.

Two policies bite in particular:

- **Allowed Client Scopes** rejects any scope that is not a client scope object
  in the realm. Claude requests `openid` and `service_account`, neither of which
  exists as a Keycloak client scope by default, so registration fails with
  `Not permitted to use specified clientScope`. Creating an empty client scope
  named `openid` and registering it as a realm optional scope satisfies the
  policy without changing what ends up in the token.
- **Trusted Hosts** does **not** understand CIDR notation. Configuring it with
  `160.79.104.0/21` looks correct and fails with `Host not trusted`, because it
  compares against exact hostnames and addresses.

### Prefer a static client over DCR

Rather than working around anonymous DCR, register a client manually and supply
its ID and secret in the connector's advanced settings. This removes the
anonymous registration endpoint from the attack surface entirely instead of
filtering access to it, and allows a confidential client (secret **and** PKCE)
where DCR produces a public one.

Restoring the Trusted Hosts policy to its default (empty host list, both checks
enabled) blocks anonymous registration completely.

**When migrating from a DCR-registered client to a static one, create the new
connector before deleting the old client.** Deleting it first leaves the
existing connector unable to refresh its token, and it cannot re-register
because registration is now closed.

### Mirror the DCR client's scope assignment

Keycloak's authorization endpoint rejects the whole request if a client asks for
a scope it has not been assigned — `Invalid scopes: …` listing everything it
asked for, which obscures which one is actually missing. Registration via DCR
assigns every realm scope to the new client automatically; a manually created
client gets only what you assign.

Claude requests roughly fourteen scopes. Assign them all (default or optional as
appropriate) — the practical approach is to inspect what a DCR-created client
received and mirror it.

### Bind the audience through a default scope

The `aud` claim comes from an audience protocol mapper inside a client scope.
Register that scope as a realm **default** scope so it applies to every client,
and keep it **default rather than optional** on the client itself. As an
optional scope it is only included when explicitly requested — if the client
ever narrows its scope request, the audience silently disappears and every call
starts failing verification.

### Social login auto-provisions users by default

Adding a social identity provider (Google, GitHub, …) so operators sign in with
an existing account is an obvious improvement — no password to manage, and the
provider's MFA comes along. Configured naively it is a **downgrade**.

A realm's `registrationAllowed: false` governs *local* self-registration only.
Brokered login takes a different path: the default `first broker login` flow
contains a `Create User If Unique` step that **creates a Keycloak user for any
account that authenticates**. With a social provider enabled and nothing else
changed, anyone with an account at that provider can sign in, get provisioned,
and receive a token carrying the audience your MCP server accepts.

Copy the flow, set `Create User If Unique` to `DISABLED`, and assign the copy to
the provider. Unknown accounts then have to match an existing user instead of
becoming one.

Two more things worth setting on the same pass:

- **A domain restriction at the provider.** Google's `hostedDomain` (and the
  equivalent elsewhere) rejects accounts outside your organisation before the
  request reaches the IdP. For Google specifically, setting the OAuth consent
  screen's user type to **Internal** — only possible when the project belongs to
  a Workspace organisation — restricts it a layer earlier still.
- **`Verify existing account by Email` to `DISABLED` if the realm has no SMTP
  server.** Account linking otherwise stalls on an email that cannot be sent.
  Re-authentication with the existing password is the alternative, and is the
  better prompt for a one-time link anyway.

Note that the linking step matches on **email**. An account whose provider email
differs from the one on the existing user will not match, so update the user's
email before the first sign-in attempt.

### Other footguns

- `kcadm.sh set-password` sets a **temporary** password by default, forcing a
  password change at first login. Combined with an incomplete user profile
  (missing first/last name while `VERIFY_PROFILE` is enabled), the token
  endpoint reports only `Account is not fully set up`, which points at neither
  cause.
- `kcadm.sh get <component> --fields config` can render `config` as empty even
  when it is populated. Fetch the whole object to confirm what was saved.

## Operational notes

### Sessions do not survive a restart

Sessions are held in the server process's memory, so any restart or redeploy
invalidates every session ID clients are holding. The server answers `404` for
an unknown session, which tells a spec-compliant client to open a fresh one; a
`400` in that position (as upstream had) reads as a malformed request and
surfaces as a generic error instead.

### `docker restart` does not re-read `--env-file`

Environment variables are captured when the container is **created**. After
editing the env file the container must be recreated (`docker rm` + `docker
run`) — `docker restart` silently keeps the old values. The symptom is
confusing: credentials are correct on disk and the API still rejects them.

### Rollback covers the image, not the configuration

A deploy script that keeps the previous image and restores it on a failed health
check protects against a bad commit. It does **not** protect against a bad
configuration change, because the env file lives outside both git and the image
— the rollback starts the previous image against the same broken config and
fails identically. Configuration changes deserve more care than code changes
here, not less.

### The audit trail needs a volume, or it dies with the container

The server logs every tool call against the identity in the caller's token
(see the README). Those lines go to stderr, which means `docker logs` — and
`docker logs` is gone the moment the container is recreated, which a deploy
does on every release and after every env-file change.

If the trail is meant to answer "who settled that title last quarter", stderr
is not where it can live. Point `MCP_AUDIT_LOG` at a path on a mounted volume
so it survives `docker rm`, and treat that file as the record.

**The mounted directory has to be writable by the container's non-root user.**
The image runs as `mcp`, not root, so a volume left owned by root produces a
server that starts, serves, and logs nothing to the file — it says so once on
stderr and falls back there, which is easy to miss if nobody is watching the
logs at that moment. `chown` the directory to the runtime UID when mounting it.

One more consequence worth planning for rather than discovering:

- **It is evidence about people.** It names who did what and when, so it
  deserves the access controls and retention rules that implies — not
  world-readable next to the application it audits.

### Rotating the audit file

The server reopens `MCP_AUDIT_LOG` on `SIGHUP` — the same convention nginx,
rsyslog and most long-running Unix daemons use, so `logrotate`'s `postrotate`
hook can drive it directly. Point it at the container:

```
# /etc/logrotate.d/mcp-omie
/var/log/mcp-omie/audit.jsonl {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    nocreate
    postrotate
        docker kill --signal=HUP mcp-omie >/dev/null 2>&1 || true
    endscript
}
```

**Use `nocreate`, not `create`.** logrotate's `create` directive pre-creates
the empty file as a host user/group before the signal is even sent — and the
container writes as its own non-root `mcp` user, whose UID on the host is
whatever Alpine's `adduser` picked, not a host account that happens to share
the name. Matching that by hand across every rotation is exactly the
ownership mismatch the "writable by the container's non-root user" note above
already warns about. `nocreate` sidesteps it: the server's own next write
recreates the file itself, under the UID that already works.

The interval and retention above (daily, keep 14) are a starting point, not a
recommendation tied to anything about this server — set them to whatever your
audit retention policy actually requires.

Verify a rotation actually took effect by tailing `docker logs` right after —
the server logs `Audit log reopened (SIGHUP) for log rotation.` on every one.
Silence there, with the file not growing, means the signal didn't reach the
process (check the container name in the `postrotate` line matches what
`deploy.sh` names it).

### Attribution stops at the App Key

Every call this server makes to Omie carries the same App Key, so Omie's own
change history attributes every change to the integration app. The audit log
and the notes-field stamp exist precisely because that native history cannot
answer the question.

Registering one Omie app per person and choosing the credential per request
from the verified token would push attribution into Omie itself. That is a
larger change than it sounds: it multiplies the secrets to rotate and the rate
limits to reason about, since Omie's throttling and its 30-minute block are per
IP + App Key + method. Worth confirming the plan even allows multiple
integration apps before designing for it.

### Verify health over the network clients use

A container can be healthy from inside its host and unreachable through the
tunnel. Checking both catches routing and binding mistakes that an internal
check alone would pass.
