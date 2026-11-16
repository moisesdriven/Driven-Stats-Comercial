# Entorno de desarrollo con la subcuenta piloto (Jade18K)

Guía para recrear en una sesión nueva la base local de prueba y lanzar el primer análisis de
calidad real. Requiere las variables del entorno: `GHL_PIT_PILOTO`, `GHL_LOCATION_ID_PILOTO` y
`ANTHROPIC_API_KEY` (nunca se escriben en el repositorio). En el entorno en la nube la clave de
Anthropic llega como `DRIVEN_ANTHROPIC_API_KEY`: se pasa al worker con
`export ANTHROPIC_API_KEY="$DRIVEN_ANTHROPIC_API_KEY"`.

## Estado pendiente (16 nov 2026)

- Fase 4 construida y probada con Anthropic simulado.
- Primer análisis real de Jade18K (semana del 9 al 15 de noviembre) hecho el 16 nov: costo real
  US$ 0,0523 frente a US$ 0,0303 estimado; revisión manual de 100 mensajes en
  `docs/validacion.md`.
- Pendiente: corregir la estimación de tokens (subestima ~70 %) y ajustar la rúbrica.

## 1. PostgreSQL local

```bash
D=/var/lib/postgresql/comercial-pruebas
mkdir -p $D && chown postgres:postgres $D
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $D/data -U postgres --auth=trust -E UTF8"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $D/data -o '-p 5432 -k /tmp' -l $D/log start"
psql -h 127.0.0.1 -U postgres -c "create database comercial_test" -c "create database piloto"
psql -h 127.0.0.1 -U postgres -d piloto -v clave_migrador=Mig_P1 -v clave_worker=Wrk_P1 -v clave_web=Web_P1 -f scripts/sql/esquema_y_roles.sql
```

## 2. Migraciones, administrador y web

```bash
pnpm install && pnpm build
CARPETA_MIGRACIONES=$PWD/packages/db/migraciones DATABASE_URL_MIGRADOR=postgres://comercial_migrador:Mig_P1@127.0.0.1:5432/piloto node apps/worker/dist/migrar.js
export CLAVE_CIFRADO=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
DATABASE_URL=postgres://comercial_web:Web_P1@127.0.0.1:5432/piloto node apps/web/cli/crear-admin.mjs --correo admin@piloto.pe --nombre "Admin Piloto"
(cd apps/web && DATABASE_URL=postgres://comercial_web:Web_P1@127.0.0.1:5432/piloto nohup ./node_modules/.bin/next start -p 3105 &)
```

Con la API (cookie de sesión del administrador, tras cambiar la contraseña temporal):

1. `POST /api/configuracion/subcuentas` con `locationId` y `token` del piloto (verifica 7 permisos).
2. Una carga incremental (trae pipelines): `node apps/worker/dist/cli.js incremental --directo`.
3. `PUT /api/configuracion/subcuentas/{id}/mapa-etapas`: Nuevo→nuevo, Contactado→contactado,
   Cotizado→por_cerrar, Adelanto/En Producción/Despachado/Pago Completo→ganado.
4. `PUT /api/subcuentas/{id}/etapas-calidad`: Contactado, Cotizado, Adelanto.
5. `PUT /api/subcuentas/{id}/horarios`: general L–V 9:00–13:00 y 14:00–18:00 desde 2026-01-01.

## 3. Carga histórica y resumen

```bash
export DATABASE_URL_WORKER=postgres://comercial_worker:Wrk_P1@127.0.0.1:5432/piloto MODO_ALERTAS=sombra
node apps/worker/dist/cli.js historico --dias 7 --directo   # ~25 min
node apps/worker/dist/cli.js resumen --dias 9
```

## 4. Análisis de calidad real

```bash
node apps/worker/dist/cli.js calidad-estimar --subcuenta $GHL_LOCATION_ID_PILOTO --desde 2026-11-09 --hasta 2026-11-15
```

Si la estimación sigue en el orden de US$ 0,06, lanzar con el botón (o
`POST /api/calidad/analisis` con `clave` del administrador) y procesar:

```bash
node apps/worker/dist/cli.js calidad-revisar   # envía el lote; repetir hasta que el análisis quede "terminado"
```
