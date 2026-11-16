# Imagen de la web (Next.js en modo standalone).
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @driven/web build
# Módulo nativo de Argon2 para los comandos de apps/web/cli (Next lo guarda con un nombre interno
# dentro de .next, inaccesible para un script aparte). Se copian archivos reales, sin enlaces.
RUN mkdir -p /cli-modulos/@node-rs \
 && for d in /repo/node_modules/.pnpm/node_modules/@node-rs/argon2*; do cp -rL "$d" /cli-modulos/@node-rs/; done

FROM node:22-alpine AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
# Comandos de administración: node apps/web/cli/crear-admin.mjs --correo ... --nombre ...
COPY --from=build --chown=app:app /repo/apps/web/cli ./apps/web/cli
COPY --from=build --chown=app:app /cli-modulos ./apps/web/cli/node_modules
USER app
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3100/api/salud || exit 1
CMD ["node", "apps/web/server.js"]
