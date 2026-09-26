# syntax=docker/dockerfile:1

# Two stages, because the toolchain that builds this application is larger than
# the application. TypeScript, vitest, eslint and their trees exist only in the
# first stage and never reach the image that runs in production.
#
# WHY slim AND NOT alpine. `bcrypt` is a native addon. Alpine links against musl
# rather than glibc, which is the platform least likely to have a prebuilt
# binary published, so `npm ci` falls back to compiling from source and fails on
# an image with no compiler. Debian slim is ~30 MB larger and does not have that
# failure mode. The toolchain is installed here anyway, so that a missing
# prebuild is a slower build rather than a broken one.

FROM node:22-slim AS build

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Dependencies before sources, so editing a source file does not invalidate the
# dependency layer. `npm ci` rather than `npm install`: it installs exactly the
# lockfile and fails instead of quietly resolving a different tree.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src

# Emits dist/ and copies the .sql migrations into it. tsc alone would produce a
# migration runner with no migrations, which fails silently at deploy time:
# "applied: 0" against an empty database. scripts/copy-migrations.mjs fails the
# build instead.
RUN npm run build

# Now that the build is done, drop everything it needed and keep exactly what
# dist/ requires. Native addons compiled above are kept as they are, not rebuilt.
RUN npm prune --omit=dev


FROM node:22-slim AS runtime

WORKDIR /app

# Set before anything else runs, because the application reads it at startup to
# decide that MONGODB_URI, REDIS_URL and CORS_ALLOWED_ORIGINS are required
# rather than optional.
ENV NODE_ENV=production

# package.json is needed at runtime: the start command runs `npm run
# migrate:prod` before the server.
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# node:slim ships an unprivileged `node` user. Running as root inside a container
# is not a sandbox: a process that escapes one is root on the host.
USER node

EXPOSE 3000

# server.ts installs SIGTERM and SIGINT handlers and drains in-flight requests,
# so Node as PID 1 is correct here. Without them PID 1 would ignore SIGTERM and
# every deploy would end in a SIGKILL after the platform's grace period.
CMD ["node", "dist/server.js"]
