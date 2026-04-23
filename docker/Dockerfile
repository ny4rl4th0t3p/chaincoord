# --- Stage 1: Build coordd ---
FROM golang:1.25-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /bin/coordd ./cmd/coordd

# --- Stage 2: Runtime image ---
FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=builder /bin/coordd /usr/local/bin/coordd