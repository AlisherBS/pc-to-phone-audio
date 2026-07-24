# Multi-stage Dockerfile for WebRTC Audio Streamer
FROM node:20-alpine AS builder

WORKDIR /app

# Copy server package files and install dependencies
COPY server/package*.json ./server/
RUN cd server && npm ci --only=production

# Copy application source code
COPY server ./server
COPY client ./client

# Runtime production image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV CLIENT_DIR=../client

# Copy built dependencies and source code
COPY --from=builder /app/server ./server
COPY --from=builder /app/client ./client

# Expose web application and WebSocket signaling port
EXPOSE 8080

# Use non-root node user for security
USER node

WORKDIR /app/server

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "server.js"]
