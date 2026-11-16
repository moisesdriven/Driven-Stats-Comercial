# Plan de trabajo

Fases según la sección 14 de `ESPECIFICACION.md`. Se trabaja en la rama
`claude/bold-ptolemy-6m09ny`, con un commit por fase, y se espera aprobación antes de pasar a la
siguiente.

| Fase | Entregable                                                                          | Estado                 |
| ---- | ----------------------------------------------------------------------------------- | ---------------------- |
| 0    | Monorepo, CI, `.env.example`, `CLAUDE.md`, este plan                                | Terminada, en revisión |
| 1    | Esquema `comercial`, roles, migraciones, cifrado, `crear-admin`, login y permisos   | Pendiente              |
| 2    | Cliente GHL, alta de subcuentas y tokens, cargas; `docs/mapeo-origen.md`            | Pendiente              |
| 3    | `packages/core`: horario laboral, indicadores, semáforo, cuello de botella, alertas | Pendiente              |
| 4    | Historial de etapas y análisis de calidad por muestra                               | Pendiente              |
| 5    | Interfaz: vista general, subcuenta, asesor, horarios, usuarios, configuración       | Pendiente              |
| 6    | Alertas y purga                                                                     | Pendiente              |
| 7    | Scripts de despliegue en PowerShell y `docs/DEPLOY.md`                              | Pendiente              |

## Decisiones tomadas al inicio

Detalle en [`decisiones.md`](decisiones.md).

## Fase 1 · plan corto

1. `packages/db`: esquema Drizzle completo de la sección 8 (con `mensajes` particionada por mes),
   `drizzle.config.ts` con `schemaFilter: ['comercial']`, primera migración.
2. `scripts/sql/esquema_y_roles.sql`: esquemas `comercial` y `comercial_cola`, los 3 roles y sus
   permisos, idempotente.
3. Cifrado AES-256-GCM de tokens y secretos TOTP, con pruebas.
4. Autenticación: Argon2id, sesión en cookie `httpOnly` + `SameSite=Lax` + `Secure`, cambio de
   contraseña obligatorio, TOTP opcional, comando `crear-admin`.
5. Permisos: matriz de la §10.1 sembrada en `permisos_rol`, excepciones por usuario, filtro por
   subcuenta en una sola capa de acceso a datos y auditoría de cambios.
6. Pruebas de integración con PostgreSQL desechable: un dueño no puede leer una subcuenta que no
   tiene asignada aunque cambie la URL o llame la API, y solo el administrador puede lanzar el
   análisis de calidad.
