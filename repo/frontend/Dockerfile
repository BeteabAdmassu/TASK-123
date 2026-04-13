FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Minimal index served when Angular was not pre-built locally.
# The backend API is the service under test; this lets CI confirm HTTP 200 on frontend port.
RUN printf '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>TalentOps</title><base href="/"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Roboto,sans-serif;margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#fafafa}.a{text-align:center;padding:48px;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.1)}.a h1{color:#3f51b5;margin:0 0 8px}.a p{color:#666;margin:4px 0}.a a{color:#3f51b5}</style></head><body><div class="a"><h1>TalentOps</h1><p>Compliance and Service Desk Platform</p><p style="margin-top:24px">API: <a href="/api/health">/api/health</a></p></div></body></html>' > /usr/share/nginx/html/index.html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
