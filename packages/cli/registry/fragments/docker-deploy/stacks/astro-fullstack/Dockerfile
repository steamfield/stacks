# syntax=docker/dockerfile:1
# check=skip=InvalidDefaultArgInFrom
# No defaults on purpose: `bun run docker-build` passes the installed Bun and .node-version, so
# a build without them fails instead of drifting from what the tests ran on.
ARG BUN_VERSION
ARG NODE_VERSION

# The API bundle and the static site are platform-independent, so the build stage runs on the
# builder's own platform.
FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS build
WORKDIR /src
# Every workspace manifest, before any source, so a source edit doesn't reinstall. A new
# workspace package adds its package.json line here.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contract/package.json packages/contract/
# --ignore-scripts: `prepare` installs git hooks, which a build has no use for.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run build

# One image: the API bundle serves the built site from STATIC_DIR. No node_modules, no source.
FROM node:${NODE_VERSION}-slim
WORKDIR /app
COPY --from=build --chown=node:node /src/apps/api/dist ./dist
COPY --from=build --chown=node:node /src/apps/web/dist ./site
# Production logs JSON to stdout and never writes logs/.
ENV NODE_ENV=production PORT_API=3000 STATIC_DIR=/app/site
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT_API}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/node.js"]
