FROM node:18-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY angular.json tsconfig.json tsconfig.app.json ./
COPY src/ ./src/

RUN npx ng build --configuration=production || npm run build -- --configuration=production

# Production stage - serve with nginx
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built Angular app — try known output paths (Angular version-dependent)
COPY --from=builder /app/dist/talentops-frontend/browser /usr/share/nginx/html 2>/dev/null || true
COPY --from=builder /app/dist/talentops-frontend /usr/share/nginx/html 2>/dev/null || true
COPY --from=builder /app/dist/ /usr/share/nginx/html 2>/dev/null || true

# Fail the build if Angular did not produce index.html — do not silently serve a placeholder
RUN test -f /usr/share/nginx/html/index.html || (echo "ERROR: Angular build did not produce index.html" && exit 1)

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
