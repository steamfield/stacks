# syntax=docker/dockerfile:1
# check=skip=InvalidDefaultArgInFrom
# Build context: frontend/. No default on purpose: `make docker-build` passes the Bun recorded
# in packageManager, so a build without it fails instead of drifting from what the tests ran on.
ARG BUN_VERSION

# The SPA build is platform-independent, so the build stage runs on the builder's own platform.
FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS build
WORKDIR /src
RUN --mount=type=cache,target=/root/.bun/install/cache \
    --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=bun.lock,target=bun.lock \
    bun install --frozen-lockfile --ignore-scripts
COPY . .
# Public build-time values only (VITE_*): declare each as an ARG here. Never a secret.
RUN bun run build

# Unprivileged nginx: runs as uid 101 and listens on 8080. It renders templates/*.template
# with the environment at start, so API_UPSTREAM can change per deploy.
FROM nginxinc/nginx-unprivileged:alpine
COPY --chown=nginx:nginx nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build --chown=nginx:nginx /src/build/client /usr/share/nginx/html
ENV API_UPSTREAM=http://api:8000
EXPOSE 8080
# A local check with busybox wget: the static server answers, whatever the API's state.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/index.html"]
