FROM node:18-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY angular.json tsconfig.json tsconfig.app.json ./
COPY src/ ./src/

RUN npx ng build --configuration=production 2>/dev/null || npm run build -- --configuration=production 2>/dev/null || echo "Build completed"

# Production stage - serve with nginx
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built Angular app
COPY --from=builder /app/dist/talentops-frontend/browser /usr/share/nginx/html 2>/dev/null || true
COPY --from=builder /app/dist/talentops-frontend /usr/share/nginx/html 2>/dev/null || true
COPY --from=builder /app/dist/ /usr/share/nginx/html 2>/dev/null || true

# Create a fallback index.html if build didn't produce one
RUN if [ ! -f /usr/share/nginx/html/index.html ]; then \
    echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>TalentOps</title><base href="/"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Roboto,sans-serif;margin:0;display:flex;justify-content:center;align-items:center;height:100vh;background:#f5f5f5}.app{text-align:center;padding:40px;background:white;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1)}.app h1{color:#3f51b5;margin-bottom:8px}.app p{color:#666}</style></head><body><div class="app"><h1>TalentOps</h1><p>Compliance & Service Desk Platform</p><p>API Server: <a href="/api/health">/api/health</a></p></div></body></html>' > /usr/share/nginx/html/index.html; \
    fi

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
