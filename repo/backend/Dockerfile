# Build context: repo root (docker-compose.yml: context: .)
FROM node:18-alpine AS builder

WORKDIR /build

# Copy shared contracts (referenced by backend tsconfig rootDir: "..")
COPY shared/ ./shared/

# Install backend dependencies
COPY backend/package.json backend/package-lock.json* ./backend/
WORKDIR /build/backend
RUN npm install

# Copy backend source and compile
COPY backend/tsconfig.json ./
COPY backend/src/ ./src/
RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────────
FROM node:18-alpine
WORKDIR /app
RUN apk add --no-cache wget

COPY backend/package.json ./
COPY --from=builder /build/backend/node_modules/ ./node_modules/
COPY --from=builder /build/backend/dist/ ./dist/

# SQL migrations at the path matching rootDir-nested output
COPY backend/src/migrations/*.sql ./dist/backend/src/migrations/

RUN mkdir -p uploads exports/notifications
EXPOSE 3000

CMD ["sh", "-c", "node dist/backend/src/migrations/run.js && node dist/backend/src/migrations/seed.js && node dist/backend/src/server.js"]
