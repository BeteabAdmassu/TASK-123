# Playwright E2E test runner
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /e2e

# Install dependencies first for layer caching
COPY package.json ./
RUN npm install

# Copy config and specs
COPY playwright.config.ts ./
COPY specs/ ./specs/

ENV CI=true

CMD ["npx", "playwright", "test", "--reporter=list"]
