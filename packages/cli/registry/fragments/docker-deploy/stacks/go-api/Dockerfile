# syntax=docker/dockerfile:1
# check=skip=InvalidDefaultArgInFrom
# GO_VERSION has no default on purpose: `make docker-build` passes go.mod's Go directive, so a
# build without it fails instead of drifting from the toolchain the tests ran on.
ARG GO_VERSION

# The build stage runs on the builder's own platform and cross-compiles, so an arm64 image
# from an amd64 runner (or the reverse) needs no emulation.
FROM --platform=$BUILDPLATFORM golang:${GO_VERSION} AS build
WORKDIR /src
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=bind,source=go.mod,target=go.mod \
    --mount=type=bind,source=go.sum,target=go.sum \
    go mod download
ARG TARGETOS TARGETARCH VERSION=dev
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=bind,target=. \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/server ./cmd/server

# Distroless has no shell or curl: the binary's own -healthcheck fetches /healthz on PORT.
FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/server /server
ENV HOST=0.0.0.0 PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["/server", "-healthcheck"]
ENTRYPOINT ["/server"]
