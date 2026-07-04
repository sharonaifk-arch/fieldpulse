# FACM — image locale optionnelle (le mode recommandé reste start_facm.bat)
# Le scan de dossier nécessite de monter le dossier Teams/OneDrive dans le conteneur.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production FACM_HOST=0.0.0.0 FACM_PORT=4560 FACM_DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY package.json ./
VOLUME /data
EXPOSE 4560
CMD ["node", "apps/server/dist/main.js"]
