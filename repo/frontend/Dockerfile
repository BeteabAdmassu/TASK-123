# Multi-stage: build Angular app, then serve with nginx
FROM node:18-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY angular.json tsconfig.json tsconfig.app.json ./
COPY src/ ./src/

RUN npx ng build --configuration=production

# ── Runtime ──────────────────────────────────────────────────────────
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Angular 17 application builder outputs to dist/<project>/browser/
COPY --from=builder /app/dist/talentops-frontend/browser/ /usr/share/nginx/html/

# Fail the build if Angular did not produce index.html
RUN test -f /usr/share/nginx/html/index.html || \
    (echo "ERROR: Angular build did not produce index.html" && exit 1)

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
