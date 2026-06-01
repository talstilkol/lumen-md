# Lumen marketplace backend — dependency-free node service.
FROM node:20-alpine
WORKDIR /app
COPY package.json registry.mjs server.mjs ./
ENV PORT=8090 MARKETPLACE_DATA=/data/marketplace-data.json
VOLUME /data
EXPOSE 8090
CMD ["node", "server.mjs"]
