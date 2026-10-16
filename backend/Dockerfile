# ==============================================================================
# docker/Dockerfile
#
# Implements Section 19.4: Multi-stage, minimal, non-root container image.
# Produces an immutable image supporting both API and Worker execution commands.
# ==============================================================================

# Stage 1: Build
FROM node:24-alpine AS builder

WORKDIR /app

# Build tools are confined to the disposable builder stage for native packages.
RUN apk add --no-cache python3 make g++

# Copy package manifests
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies) for compilation
RUN npm ci

# Copy backend source code and tsconfig
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript to JavaScript
RUN npm run build

# Prune devDependencies to keep only production dependencies
RUN npm prune --omit=dev

# Stage 2: Production Runtime
FROM node:24-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Security: Run as unprivileged non-root user
USER node

# Copy production node_modules from builder
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/package.json ./package.json

# Copy compiled artifacts from builder
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/src/infrastructure/database/postgres/migrations ./src/infrastructure/database/postgres/migrations

# Healthcheck probing process liveness
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

STOPSIGNAL SIGTERM
EXPOSE 3000

# Default command: API server (Worker process overrides with: node dist/worker.js)
CMD ["node", "dist/server.js"]