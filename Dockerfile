# Multi-stage Docker build for TracePulse Observability Engine
FROM node:24-alpine AS base
WORKDIR /app

# Stage 1: Build client and server
FROM base AS builder
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

COPY shared/ ./shared/
COPY server/ ./server/
COPY client/ ./client/

RUN npm run build

# Stage 2: Production runtime
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=4000

COPY package.json ./
COPY server/package.json ./server/
COPY --from=builder /app/node_modules ./node_modules
# server/dist already contains the compiled shared/ modules (tsc's rootDir spans
# server/src and ../shared, see server/tsconfig.json), so shared/ is not copied.
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

# The SQLite file is created at /app/data/tracepulse.db (relative to the working
# directory), so that directory must exist and be writable by the unprivileged user.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 4000

CMD ["node", "server/dist/server/src/index.js"]
