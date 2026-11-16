# Driven Comercial · convenciones del proyecto

Sistema interno de Driven para medir la eficiencia de los equipos comerciales de las subcuentas de
GoHighLevel. **Fuente de verdad:** `ESPECIFICACION.md`. Diseño aprobado: `diseno/*.dc.html`
(referencia visual, no se ejecuta). Plan y estado: `docs/PLAN.md`.

## Reglas que no se rompen

- Proyecto **independiente de Driven Conteo**. Solo se usan los esquemas `comercial` y
  `comercial_cola` y los roles `comercial_web`, `comercial_worker` y `comercial_migrador`. Nunca leer
  ni modificar los esquemas `ghl` o `app`, ni contenedores, redes o proxy de Conteo.
- **Solo lectura sobre GHL.** Ningún código escribe ni envía nada a GHL.
- **Ningún secreto en el repositorio.** Variables nuevas se documentan en `.env.example`.
- **Permisos en el servidor:** toda consulta filtra por las subcuentas del usuario (y por su
  `userId` de GHL si es asesor). Nunca confiar en filtros del navegador.
- Las pruebas nunca usan tokens reales: GHL y Anthropic simulados.
- No inventar reglas de negocio: si la especificación es ambigua, preguntar.
- Idioma: interfaz, mensajes, documentación, comentarios y commits en **español neutro**.
  Identificadores de código en español cuando son conceptos de negocio (`minutosLaborales`,
  `peorEstado`).

## Estructura

```
apps/web         Next.js 16 (App Router): vistas, API propia, login, administración
apps/worker      Jobs con pg-boss (empaquetado con tsup)
packages/core    Reglas de negocio puras + pruebas (sin E/S)
packages/ghl     Cliente de solo lectura de la API v2 de GHL
packages/db      Esquema Drizzle `comercial`, migraciones, cifrado
packages/ui      Tokens de diseño y componentes
docker/          Dockerfiles y docker-compose de producción
scripts/deploy   Despliegue con PowerShell (fase 7)
scripts/sql      Creación de esquemas y roles
docs/            Plan, decisiones, mapeos, despliegue
```

Los paquetes de `packages/*` se publican como TypeScript (`exports: ./src/index.ts`): Next los
transpila (`transpilePackages`) y el worker los empaqueta con tsup.

## Comandos

```bash
pnpm install
pnpm dev --filter @driven/web      # web en http://localhost:3100
pnpm format                        # Prettier
pnpm lint                          # ESLint
pnpm typecheck                     # tsc en cada paquete
pnpm test                          # Vitest (todos los proyectos)
pnpm build                         # build de web y worker
pnpm verificar                     # todo lo anterior, como en CI
```

Al terminar cada fase: `pnpm verificar` en verde, commit y resumen.

## Stack y versiones

Node 22 · pnpm 10 · TypeScript 6.0 estricto (`noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`) · Next.js 16 · React 19 · ESLint 9 (flat config) · Prettier ·
Vitest 5 · Drizzle ORM · pg-boss · Zod 4 · Playwright.

TypeScript se mantiene en 6.0.x porque `typescript-eslint` aún no soporta la 7.

## Entorno de desarrollo en la nube

Variables disponibles: el PIT de la subcuenta piloto llega como `GHL_LOCATION_TOKEN` /
`GHL_LOCATION_ID` (nombres equivalentes a `GHL_PIT_PILOTO` / `GHL_LOCATION_ID_PILOTO`). El código
de inspección acepta ambos nombres.
