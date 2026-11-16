# Imagen del worker (jobs con pg-boss).
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @driven/worker build
# Solo dependencias de producción del worker (los paquetes del monorepo ya van empaquetados en dist).
RUN pnpm --filter @driven/worker deploy --prod --legacy /out

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out/node_modules ./node_modules
COPY --from=build --chown=app:app /out/package.json ./package.json
COPY --from=build --chown=app:app /repo/apps/worker/dist ./dist
USER app
CMD ["node", "dist/index.js"]
