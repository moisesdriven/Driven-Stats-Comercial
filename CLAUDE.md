# Driven Comercial · convenciones del proyecto

Sistema interno de Driven para medir la eficiencia de los equipos comerciales de las subcuentas de
GoHighLevel. **Fuente de verdad:** `ESPECIFICACION.md`. Diseño aprobado: `diseno/*.dc.html`
(referencia visual, no se ejecuta). Plan y estado: `docs/PLAN.md`.

## Reglas que no se rompen

- Proyecto **independiente de Driven Conteo y de DrivenBox**, con **PostgreSQL propio**
  (contenedor `comercial-db`; decisión del cliente que reemplaza la "misma instancia" de la §2).
  Esquemas `comercial` y `comercial_cola`, roles `comercial_web`, `comercial_worker` y
  `comercial_migrador`. Nunca tocar `drivenbox-db`, los esquemas `ghl`/`app` ni contenedores, redes
  o configuración de otras aplicaciones. Única red ajena: `web` (Traefik), solo para publicarse.
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
pnpm e2e                           # Playwright contra el build (requiere DATABASE_URL_TEST)
```

Al terminar cada fase: `pnpm verificar` en verde, commit y resumen.

### Pruebas de integración

Necesitan un PostgreSQL desechable en `DATABASE_URL_TEST` (si falta, se omiten; en CI siempre
corren). Recrean el esquema `comercial` desde cero. Nunca apuntar a una base real.

```bash
DATABASE_URL_TEST=postgres://postgres@127.0.0.1:5432/comercial_test pnpm test
```

## Base de datos

- Esquema en `packages/db/src/esquema/index.ts`. Para un cambio: editar el esquema y
  `pnpm --filter @driven/db generar` (drizzle-kit). Revisar el SQL generado antes de confirmarlo.
  Mientras no haya nada desplegado se regenera `0000_inicial.sql` y se le aplica
  `node scripts/ajustar-migracion.mjs migraciones/0000_inicial.sql` (desde `packages/db`).
- `mensajes` está particionada por mes (editado a mano en `0000_inicial.sql`): drizzle-kit no
  modela particiones. Su PK es `(message_id, fecha)`. Las particiones se crean con
  `comercial.asegurar_particiones_mensajes(desde, meses)`; no hay partición por defecto.
- Las migraciones se aplican con `migrar()` de `@driven/db/migrar` (no con el migrador de Drizzle:
  ese ejecuta `CREATE SCHEMA` y el rol migrador no tiene ese permiso, a propósito). La web nunca
  importa `@driven/db/migrar`.
- `scripts/sql/esquema_y_roles.sql` crea esquemas y roles; es idempotente.

## Seguridad y permisos (apps/web/src/servidor)

- `acceso.ts`: `cargarContexto` recalcula rol, subcuentas y módulos en **cada** petición.
  Toda consulta nueva recibe el `ContextoAcceso`, llama a `exigirModulo`/`exigirSubcuenta` y
  además filtra por `ctx.subcuentas` dentro del SQL (`consultas/`).
- `http.ts`: `requerirSesion`, `leerJson` (Zod), `manejar` (errores → JSON) y control de Origin.
- Contraseñas Argon2id (`claves.ts`), sesiones en tabla `sesiones` (se guarda el SHA-256 del
  token), TOTP propio (`totp.ts`), CSP con nonce en `src/proxy.ts`.
- Cada acción relevante se registra con `auditar()`; nunca guardar contraseñas ni tokens ahí.

## Stack y versiones

Node 22 · pnpm 10 · TypeScript 6.0 estricto (`noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`) · Next.js 16 · React 19 · ESLint 9 (flat config) · Prettier ·
Vitest 5 · Drizzle ORM · pg-boss · Zod 4 · Playwright.

TypeScript se mantiene en 6.0.x porque `typescript-eslint` aún no soporta la 7.

## Entorno de desarrollo en la nube

- Subcuenta piloto: **Jade18K** (`93mgPQwURqpEvyzZcf9m`). Su PIT de solo lectura llega en
  `GHL_PIT_PILOTO` (y el id en `GHL_LOCATION_ID_PILOTO`). `GHL_LOCATION_TOKEN`/`GHL_LOCATION_ID`
  son de otra subcuenta (ETT) y **no** se usan para el piloto. `GHL_AGENCY_TOKEN` solo para listar
  subcuentas.
- PostgreSQL 16 local para pruebas: binarios en `/usr/lib/postgresql/16/bin` (initdb como usuario
  `postgres`). Para recrear la base del piloto y lanzar el análisis de calidad real:
  `docs/desarrollo-piloto.md`.
- Para construir imágenes Docker aquí, el proxy del entorno exige su certificado dentro del build;
  se usa una copia temporal del Dockerfile (nunca se modifica el del repositorio).
