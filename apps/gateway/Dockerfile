# Multi-stage Dockerfile for Messaging Orchestrator
# Optimized for production with Bun

FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json ./
RUN bun install --production

# Development dependencies
FROM base AS dev-deps
COPY package.json ./
RUN bun install

# Build stage (if needed for future compilation)
FROM base AS builder
WORKDIR /app
COPY --from=dev-deps /app/node_modules ./node_modules
COPY . .

# Production stage
FROM base AS production
WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy application code
COPY src ./src
# Operational scripts, e.g. setting a business owner's first password. The
# deployment README tells operators to run these with `docker compose exec`,
# which only works if they are in the image.
COPY scripts ./scripts
COPY drizzle.config.ts ./
COPY package.json ./

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD bun run -e "fetch('http://localhost:3000/api/messaging/health').then(r => r.ok ? process.exit(0) : process.exit(1))"

# Start application
CMD ["bun", "run", "src/index.ts"]
