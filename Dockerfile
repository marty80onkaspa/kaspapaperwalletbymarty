# ---------- BUILD ----------
FROM node:20-alpine AS build
WORKDIR /app

# Installe les deps (priorité Yarn si yarn.lock présent)
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \
  if [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then npm i -g pnpm && pnpm i --frozen-lockfile; \
  else npm i; fi

# Copie le code et build Vite -> dist/
COPY . .
RUN \
  if [ -f yarn.lock ]; then yarn build; \
  elif [ -f pnpm-lock.yaml ]; then pnpm build; \
  else npm run build; fi

# ---------- RUNTIME (NGINX) ----------
FROM nginx:1.27-alpine
# MIME + gzip + fallback SPA
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Fichiers statiques
COPY --from=build /app/dist /usr/share/nginx/html
# Healthcheck pour Dokploy
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1 || exit 1
EXPOSE 80
