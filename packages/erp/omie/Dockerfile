# mcp-omie — standalone Docker image
#
# Self-contained: builds only from this directory (packages/erp/omie), not the
# monorepo root. Deliberately isolated from the rest of mcp-dev-latam so this
# image's dependency tree matches exactly what was security-audited — no
# devDependencies (vitest/vite/etc.) or unrelated workspace packages leak in.
#
# Build (from inside packages/erp/omie/):
#   docker build -t mcp-omie .
#
# Run (HTTP transport, credentials via env — never bake secrets into the image):
#   docker run -d --name mcp-omie -p 3000:3000 \
#     -e OMIE_APP_KEY=xxxxx \
#     -e OMIE_APP_SECRET=xxxxx \
#     mcp-omie
#
# Health check:  curl http://localhost:3000/health
# MCP endpoint:  POST http://localhost:3000/mcp

# ---- builder ----------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /build

# Lockfile is scoped to this package alone (npm audit: 0 vulnerabilities as
# of 2026-08-12) — install with `ci` for a reproducible, exact-version build.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
# The whole source tree: the server is split across src/tools/*. src/__tests__
# is excluded by .dockerignore, so the build image still never needs vitest
# (which isn't a dependency of this package).
COPY src/ ./src/
RUN npm run build

# Drop devDependencies (typescript, @types/node) before it's copied forward.
RUN npm prune --omit=dev

# ---- runtime ------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV MCP_HTTP=true
ENV MCP_PORT=3000

# Non-root user — this process handles real ERP write credentials.
RUN addgroup -S mcp && adduser -S mcp -G mcp

COPY --from=builder --chown=mcp:mcp /build/package.json ./package.json
COPY --from=builder --chown=mcp:mcp /build/node_modules ./node_modules
COPY --from=builder --chown=mcp:mcp /build/dist ./dist

USER mcp
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

# OMIE_APP_KEY / OMIE_APP_SECRET are intentionally NOT set here — pass them
# at `docker run` / `docker compose` / systemd-unit time (env, --env-file,
# or a secrets store). They are never present in this image's layers.
CMD ["node", "dist/index.js"]
