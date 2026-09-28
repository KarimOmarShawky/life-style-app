# ==============================================================================
# docker/Dockerfile
#
# Implements Section 19.4: Multi-stage, minimal, non-root container image.
# Produces an immutable image supporting both API and Worker execution commands.
# ==============================================================================

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY backend/package.json backend/package-lock.json ./

# Install all dependencies (including devDependencies) for compilation
RUN npm ci

# Copy backend source code and tsconfig
COPY backend/tsconfig.json ./
COPY backend/src ./src

# Compile TypeScript to JavaScript
RUN npm run build

# Prune devDependencies to keep only production dependencies
RUN npm prune --omit=dev

# Stage 2: Production Runtime
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Install curl for HEALTHCHECK
RUN apk add --no-cache curl

# Security: Run as unprivileged non-root user
USER node

# Copy production node_modules from builder
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/package.json ./package.json

# Copy compiled artifacts from builder
COPY --chown=node:node --from=builder /app/dist ./dist

# Healthcheck probing process liveness
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health/live || exit 1

EXPOSE 3000

# Default command: API server (Worker process overrides with: node dist/worker.js)
CMD ["node", "dist/server.js"]
