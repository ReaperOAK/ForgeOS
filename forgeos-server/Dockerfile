# ---- Stage 1: Builder ----
# Compiles TypeScript source into JavaScript. Build artifacts are copied to
# the runtime stage; everything else (source, devDependencies) is discarded.
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests first to maximise Docker layer caching.
# Subsequent source changes won't invalidate the npm ci layer.
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

# Copy source and compile TypeScript (output goes to dist/).
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN npm run build

# ---- Stage 2: Runtime ----
# Minimal production image. Contains only compiled JS, production
# node_modules, and a health-check binary. Runs as non-root user "node".
FROM node:22-alpine AS runtime

WORKDIR /app

# curl is required by the HEALTHCHECK instruction below.
RUN apk add --no-cache curl

# Copy compiled output and dependencies from the builder stage.
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY package.json ./

# Copy SQL migration files (not emitted by tsc).
COPY src/db/migrations/ ./dist/db/migrations/

# Copy tree-sitter grammar WASM files (binary assets, not emitted by tsc).
COPY src/services/parsers/grammars/ ./dist/services/parsers/grammars/

# Dashboard static assets (created in a later phase; see TASK-FOS-08-004).
COPY src/dashboard/ ./dist/dashboard/

ENV NODE_ENV=production

# Drop privileges — run the server as the built-in non-root "node" user.
USER node

EXPOSE 3011

# Probe the /health endpoint every 30 s. The container is marked unhealthy
# after 3 consecutive failures, giving orchestrators a signal to restart it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3011/health || exit 1

CMD ["node", "dist/index.js"]
