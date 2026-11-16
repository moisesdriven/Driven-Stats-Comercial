-- =====================================================================================
-- Driven Comercial · esquemas y roles propios
--
-- Se ejecuta UNA vez (y se puede repetir sin efectos: es idempotente) con un usuario
-- administrador de PostgreSQL, conectado a la base de datos compartida. Lo lanza
-- scripts/deploy/02-crear-esquema-y-roles.ps1 previa confirmación.
--
-- Crea solo:  esquemas "comercial" y "comercial_cola"
--             roles comercial_migrador, comercial_worker y comercial_web
-- No toca ningún otro esquema, rol ni objeto (en particular, nada de Driven Conteo).
--
-- Las contraseñas se pasan como variables de psql, nunca escritas en este archivo:
--   psql -v ON_ERROR_STOP=1 -v clave_migrador=... -v clave_worker=... -v clave_web=... -f esquema_y_roles.sql
-- =====================================================================================

\set ON_ERROR_STOP on

BEGIN;

-- 1. Roles (se crean si no existen; si existen, se actualiza su contraseña).
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', r)
FROM unnest(ARRAY['comercial_migrador', 'comercial_worker', 'comercial_web']) AS r
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
\gexec

ALTER ROLE comercial_migrador PASSWORD :'clave_migrador';
ALTER ROLE comercial_worker PASSWORD :'clave_worker';
ALTER ROLE comercial_web PASSWORD :'clave_web';

-- Límite de conexiones para no afectar a las demás aplicaciones de la instancia.
ALTER ROLE comercial_migrador CONNECTION LIMIT 5;
ALTER ROLE comercial_worker CONNECTION LIMIT 15;
ALTER ROLE comercial_web CONNECTION LIMIT 20;

-- Solo pueden conectarse a esta base.
SELECT format('GRANT CONNECT ON DATABASE %I TO comercial_migrador, comercial_worker, comercial_web', current_database())
\gexec

-- 2. Esquemas propios.
CREATE SCHEMA IF NOT EXISTS comercial AUTHORIZATION comercial_migrador;
CREATE SCHEMA IF NOT EXISTS comercial_cola AUTHORIZATION comercial_worker;
ALTER SCHEMA comercial OWNER TO comercial_migrador;
ALTER SCHEMA comercial_cola OWNER TO comercial_worker;

-- 3. Permisos sobre "comercial": el migrador es dueño (crea tablas con las migraciones);
--    web y worker solo leen y escriben datos.
GRANT USAGE ON SCHEMA comercial TO comercial_web, comercial_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA comercial TO comercial_web, comercial_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA comercial TO comercial_web, comercial_worker;

ALTER DEFAULT PRIVILEGES FOR ROLE comercial_migrador IN SCHEMA comercial
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO comercial_web, comercial_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE comercial_migrador IN SCHEMA comercial
  GRANT USAGE, SELECT ON SEQUENCES TO comercial_web, comercial_worker;
-- Las funciones nuevas no se ejecutan por defecto: se conceden de forma explícita abajo.
ALTER DEFAULT PRIVILEGES FOR ROLE comercial_migrador IN SCHEMA comercial
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- La función que crea particiones de "mensajes" (si ya existe la migración inicial).
SELECT 'GRANT EXECUTE ON FUNCTION comercial.asegurar_particiones_mensajes(date, integer) TO comercial_worker'
WHERE to_regprocedure('comercial.asegurar_particiones_mensajes(date, integer)') IS NOT NULL
\gexec

-- 4. "comercial_cola" es de pg-boss: el worker es dueño y crea sus tablas.
REVOKE ALL ON SCHEMA comercial_cola FROM PUBLIC;
REVOKE ALL ON SCHEMA comercial FROM PUBLIC;

COMMIT;

-- 5. Verificación: los roles propios NO deben tener acceso a ningún otro esquema de la base
--    (por ejemplo "ghl" o "app" de Driven Conteo). Este script no cambia permisos ajenos;
--    si aparece alguna fila, se informa para revisarla con el equipo dueño de ese esquema.
SELECT r.rolname AS rol, n.nspname AS esquema_con_acceso
FROM pg_namespace n
CROSS JOIN (VALUES ('comercial_migrador'), ('comercial_worker'), ('comercial_web')) AS r(rolname)
WHERE n.nspname NOT IN ('comercial', 'comercial_cola', 'public', 'information_schema')
  AND n.nspname NOT LIKE 'pg\_%'
  AND has_schema_privilege(r.rolname, n.oid, 'USAGE')
ORDER BY 1, 2;

\echo 'Listo: esquemas comercial y comercial_cola, y roles comercial_* configurados.'
