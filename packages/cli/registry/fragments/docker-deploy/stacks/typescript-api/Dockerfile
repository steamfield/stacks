# syntax=docker/dockerfile:1
# check=skip=InvalidDefaultArgInFrom
# No defaults on purpose:`bun run docker-build` passes the installed Bun and .node-version, so a build
# without them fails instead of drifting from what the tests ran on.
ARG BUN_VERSION
ARG NODE_VERSION

# The bundle is plain JavaScript, so the build stage runs on the builder's own platform.
FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS build
WORKDIR /src
# --ignore-scripts: `prepare` installs git hooks, which a build has no use for.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=bun.lock,target=bun.lock \
    bun install --frozen-lockfile --ignore-scripts
COPY package.json bun.lock tsconfig.json ./
COPY src ./src
RUN bun run build

# Only the bundle ships: no node_modules, no source.
FROM node:${NODE_VERSION}-slim
WORKDIR /app
COPY --from=build --chown=node:node /src/dist ./dist
# Production logs JSON to stdout and never writes logs/.
ENV NODE_ENV=production PORT_API=3000
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT_API}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/node.js"]
