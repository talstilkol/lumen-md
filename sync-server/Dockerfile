# y-webrtc signaling server for Lumen.
# Build:  docker build -t lumen-signal sync-server/
# Run:    docker run -p 4444:4444 lumen-signal
# Deploy: fly deploy (uses fly.toml in this directory)

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

FROM node:20-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./

# y-webrtc signaling listens on 4444 by default; PORT env overrides it.
ENV NODE_ENV=production
ENV PORT=4444
EXPOSE 4444

# Healthcheck — Fly looks for HTTP 200 on /. server.js responds to GET / with a
# small JSON body so probes pass without WebSocket-upgrade gymnastics.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O - http://localhost:4444/ > /dev/null || exit 1

CMD ["node", "server.js"]
