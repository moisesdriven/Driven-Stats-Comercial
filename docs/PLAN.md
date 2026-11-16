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

## Fase 1 · resultado

- Esquema completo de la §8 (más `sesiones`), `mensajes` particionada por mes, migración inicial.
- `scripts/sql/esquema_y_roles.sql` idempotente; verifica que los roles propios no tengan acceso a
  otros esquemas (`ghl`, `app`).
- Cifrado AES-256-GCM, Argon2id, sesiones con vencimiento deslizante, 2FA TOTP, cambio de
  contraseña obligatorio, bloqueo tras 5 intentos fallidos, CSP con nonce.
- Permisos de la §10.1 con excepciones por usuario; filtro por subcuenta en cada consulta.
- API: ingreso, salida, cambio de contraseña, 2FA, `/api/yo`, subcuentas, detalle de asesor,
  usuarios (alta, edición, restablecer contraseña) y el resguardo del análisis de calidad.
- `crear-admin` dentro de la imagen web; `migrar` dentro de la imagen del worker.
- 55 pruebas (unitarias e integración con PostgreSQL).

## Fase 2 · plan corto

1. `packages/ghl`: cliente de solo lectura (header `Version` y paginación verificados en la
   documentación oficial), límite de ráfaga, reintentos 429/5xx con backoff y jitter, registro de
   llamadas sin tokens, verificación de permisos del PIT. Pruebas con un GHL simulado.
2. Inspección de mensajes reales de Jade18K y `docs/mapeo-origen.md` (manual, workflow, agente IA,
   campaña) para aprobación. Verificar si los registros de actividad traen los cambios de etapa.
3. Alta de subcuentas y tokens (API + verificación de permisos), cifrados en `credenciales`.
4. Worker con pg-boss (`comercial_cola`): `sync:incremental`, `sync:nocturno`, `sync:historico`,
   upserts idempotentes, `sync_estado` y construcción de `historial_etapas`.
5. Carga real de Jade18K en modo sombra.
