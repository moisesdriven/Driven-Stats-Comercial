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

## Fase 2 · resultado

- `docs/mapeo-origen.md` aprobado: origen de cada mensaje (el agente de IA envía como `app` con el
  `userId` de la asesora; se separa con `GET /conversation-ai/generations`), historial de etapas
  desde actividades, ventas por etapa (Adelanto o posterior en Jade18K) y modelo de eventos.
- `packages/ghl`: cliente de solo lectura (Version y paginación verificados en la documentación
  oficial), límite de 80 llamadas cada 10 s por subcuenta, reintentos con backoff y jitter,
  `User-Agent` propio (Cloudflare bloquea los genéricos), verificación de 7 permisos y un GHL
  simulado para las pruebas.
- Modelo de datos: un lead por contacto y subcuenta, tabla central `eventos` (lead recibido,
  asignación, primeras respuestas, cambio de etapa, venta, venta cancelada, pérdida, reapertura),
  estado de entrega y tipo de contenido por mensaje, motivos de pérdida y registro de cada carga.
- Worker con pg-boss: `sync-incremental` (15 min), `sync-nocturno` (02:30 Lima) y
  `sync-historico` (manual, reanudable por día). Comando `node dist/cli.js`.
- API de configuración: alta de subcuenta con verificación del PIT, mapa de etapas, 3 etapas de
  calidad y estado de las cargas.
- Carga real de Jade18K en modo sombra (ver `docs/validacion.md`).

## Fase 3 · plan corto

1. `packages/core`: horario laboral por asesor (`minutosLaborales`, `sumarTiempoLaboral`,
   `diasLaborales`) con todas las pruebas de la §4.
2. Los 8 indicadores y las 12 preguntas, semáforo, estado por etapa, cuello de botella y alertas
   cruzadas, calculados desde `eventos`, `mensajes`, `leads` y `oportunidades`.
3. Intentos de contacto, respuesta efectiva, abandono, pendientes frente a vencidos y perdidos por
   falta de seguimiento.
4. `calcular:resumen` → `resumen_diario`; validación de 20 leads a mano en `docs/validacion.md`.
