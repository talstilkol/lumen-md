# ── Stage 1: Build ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first (layer cache optimization)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY . .
RUN npm run build

# ── Stage 2: Serve ────────────────────────────────────────────────────────
# Use a minimal static-file server. The Lumen app is a fully static SPA;
# all it needs is an HTTP server that serves `dist/` with proper headers.
FROM nginx:alpine AS runtime

# Security: run as non-root
RUN adduser -D -u 1001 lumen && \
    chown -R lumen:lumen /var/cache/nginx /var/run /var/log/nginx

# Copy the custom nginx config
COPY deploy/nginx.conf /etc/nginx/nginx.conf

# Copy the built assets from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Healthcheck for orchestrators (Docker Compose, Fly.io, K8s)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost:8080/favicon.svg || exit 1

EXPOSE 8080

USER lumen

CMD ["nginx", "-g", "daemon off;"]
