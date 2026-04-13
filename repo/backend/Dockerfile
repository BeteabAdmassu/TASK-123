FROM node:18-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache wget

COPY package.json package-lock.json* ./
RUN npm install --production

COPY --from=builder /app/dist ./dist
COPY src/migrations/*.sql ./dist/migrations/

RUN mkdir -p uploads exports/notifications

EXPOSE 3000

# Run migrations, seed, then start server
CMD ["sh", "-c", "node dist/migrations/run.js && node dist/migrations/seed.js && node dist/server.js"]
