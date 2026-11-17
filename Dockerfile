# Spec to prod sur le VPS, derrière le Traefik de Coolify.
FROM node:24-slim
WORKDIR /app

# tsx sert au démarrage : les dépendances de développement restent dans l'image.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    BASE_CHEMIN=/app/donnees/spec-to-prod.db

# La base vit sur un volume : elle survit à chaque mise à jour.
RUN mkdir -p /app/donnees && chown -R node:node /app/donnees
VOLUME ["/app/donnees"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/sante').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

USER node
CMD ["./node_modules/.bin/tsx", "src/serveur/index.ts"]
