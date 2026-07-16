FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY src ./src
RUN bun build --compile --minify src/index.ts --outfile server

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=builder /app/server ./server
EXPOSE 3000
ENV NODE_ENV=production
CMD ["./server"]
