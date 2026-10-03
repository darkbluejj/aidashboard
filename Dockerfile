# Multi-stage Dockerfile for Family Dashboard on Raspberry Pi 5 (ARM64) & Home Assistant
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and config files
COPY . .

# Build the client and server bundles
RUN npm run build

# Production runtime stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled build output from builder stage
COPY --from=builder /app/dist ./dist

# Copy default state / config templates if present
COPY --from=builder /app/closedown_config.json ./closedown_config.json
COPY --from=builder /app/closedown_store.json ./closedown_store.json
COPY --from=builder /app/swearjar_store.json ./swearjar_store.json
COPY --from=builder /app/maps_usage_store.json ./maps_usage_store.json

# Expose server port
EXPOSE 3000

# Start server
CMD ["node", "dist/server.cjs"]
