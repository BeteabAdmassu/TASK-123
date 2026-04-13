FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache wget

# Copy pre-built artifacts and dependencies
COPY package.json ./
COPY node_modules/ ./node_modules/
COPY dist/ ./dist/
COPY src/migrations/*.sql ./dist/migrations/

RUN mkdir -p uploads exports/notifications

EXPOSE 3000

# Run migrations, seed, then start server
CMD ["sh", "-c", "node dist/migrations/run.js && node dist/migrations/seed.js && node dist/server.js"]
