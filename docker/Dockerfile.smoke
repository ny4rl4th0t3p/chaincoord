# --- Stage 1: Build Go binaries ---
FROM golang:1.25-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /bin/coordd       ./cmd/coordd
RUN CGO_ENABLED=0 go build -o /bin/smoke-signer ./cmd/smoke-signer

# --- Stage 2: Download gaiad ---
FROM alpine:3.20 AS gaiad-fetcher
ARG GAIA_VERSION=v27.1.0
RUN apk add --no-cache curl
RUN curl -fsSL \
  "https://github.com/cosmos/gaia/releases/download/${GAIA_VERSION}/gaiad-${GAIA_VERSION}-linux-amd64" \
  -o /bin/gaiad && chmod +x /bin/gaiad

# --- Stage 3: Runtime image ---
FROM alpine:3.20
RUN apk add --no-cache ca-certificates bash jq curl
COPY --from=builder       /bin/coordd        /usr/local/bin/coordd
COPY --from=builder       /bin/smoke-signer  /usr/local/bin/smoke-signer
COPY --from=gaiad-fetcher /bin/gaiad         /usr/local/bin/gaiad