# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f server/Dockerfile .

# --- web UI -----------------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- server -----------------------------------------------------------------
FROM golang:1.24-alpine AS server
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/fleetd ./cmd/fleetd && mkdir -p /out/data

# --- runtime ----------------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=server /out/fleetd /app/fleetd
COPY --from=web /web/dist /app/web
# Uploaded files (job attachments); mount a volume here.
COPY --from=server --chown=nonroot:nonroot /out/data /data
ENV HTTP_ADDR=:8080 \
    TELTONIKA_ADDR=:5027 \
    WEB_DIR=/app/web \
    DATA_DIR=/data \
    LOG_FORMAT=json
EXPOSE 8080 5027/tcp 5027/udp
USER nonroot:nonroot
ENTRYPOINT ["/app/fleetd"]
