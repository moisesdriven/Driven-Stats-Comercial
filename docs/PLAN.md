# Plan de trabajo

Fases según la sección 14 de `ESPECIFICACION.md`. Se trabaja en la rama
`claude/bold-ptolemy-6m09ny`, con un commit por fase, y se espera aprobación antes de pasar a la
siguiente.

| Fase | Entregable                                                                          | Estado                 |
| ---- | ----------------------------------------------------------------------------------- | ---------------------- |
| 0    | Monorepo, CI, `.env.example`, `CLAUDE.md`, este plan                                | Terminada              |
| 1    | Esquema `comercial`, roles, migraciones, cifrado, `crear-admin`, login y permisos   | Terminada              |
| 2    | Cliente GHL, alta de subcuentas y tokens, cargas; `docs/mapeo-origen.md`            | Terminada              |
| 3    | `packages/core`: horario laboral, indicadores, semáforo, cuello de botella, alertas | Terminada              |
| 4    | Historial de etapas y análisis de calidad por muestra                               | Construida, validando  |
| 5    | Interfaz: vista general, subcuenta, asesor, horarios, usuarios, configuración       | Terminada, en revisión |
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

## Fase 3 · resultado

- `packages/core/horario.ts`: `minutosLaborales`, `sumarTiempoLaboral`, `diasLaborales` y
  `enHorarioLaboral`, con tramos partidos, vigencias, feriados, vacaciones y cualquier zona horaria
  (probado con el horario de verano de Nueva York).
- `packages/core/indicadores.ts`: métricas por lead y acumulados diarios sumables (las medianas se
  calculan sobre todos los registros); los 8 indicadores y las 12 preguntas.
- `packages/core/semaforo.ts`: metas por defecto, semáforo, estado por etapa, cuello de botella y
  alertas cruzadas.
- Worker: `resumen_diario` por día × asesor × subcuenta tras cada carga; `cli.js resumen`.
- API: vista general (suma de las subcuentas del usuario), indicadores por subcuenta y por asesor,
  horarios y ausencias.
- Validación: 20 de 20 leads coinciden con GHL (`docs/validacion.md`).

## Fase 4 · plan corto

1. Historial de etapas ya construido en la fase 2; falta usarlo para el universo de calidad.
2. Análisis de calidad por muestra (§6): universo elegible (salientes `manual` en las 3 etapas de
   calidad), muestra estratificada por asesor con semilla, filtros sin IA, una solicitud por
   conversación, Message Batches API, caché de instrucciones, costo estimado y tope mensual.
3. Botón manual solo para administradores (con revalidación, ya implementada) y ejecución mensual.
4. Mejor y peor mensaje por asesor; indicador "Calidad" en el semáforo de Negociación.
5. Antes del primer análisis real: mostrar el costo estimado y esperar aprobación.

## Fase 5 · resultado

- Pantallas según `diseno/*.dc.html`, con datos reales de Jade18K: vista general (`/`), subcuenta
  (`/subcuentas/[id]`), detalle del asesor (`/subcuentas/[id]/asesores/[userId]`, con panel de mejor
  y peor mensaje), `/horarios` (editor semanal, copiar a otro asesor, ausencias y feriados),
  `/usuarios` (rol, subcuentas, módulos con excepciones, alta y restablecer contraseña), `/metas`
  (metas, umbrales y las 3 etapas de calidad) y `/configuracion` (subcuentas y tokens, mapa de
  etapas, estado de cargas y calidad: historial, gasto frente al tope y botón con estimación y
  contraseña).
- El menú solo muestra los módulos permitidos; una URL sin permiso responde 403 (`forbidden()` y
  `enPagina()` para las consultas que rechazan por permisos).
- API nueva: `PUT /api/subcuentas/[id]/metas` y `GET /api/exportar` (CSV de indicadores agregados,
  sin textos ni contactos, protegido contra fórmulas y registrado en auditoría).
- Corrección de permisos: un asesor con "editar" en horarios ya no puede cambiar el horario general
  ni registrar feriados de la subcuenta.
- Pruebas: integración de metas, exportar y horarios; prueba de punta a punta con Playwright
  (`pnpm e2e`, también en CI) para login, menú por rol y 403.
- Modo de tiempo por subcuenta (pantalla Horarios): **horario laboral** de cada asesor o **tiempo
  corrido** (24/7, sin feriados ni ausencias) para equipos con horarios variables. Se guarda en
  `subcuentas.horario_general`. Al cambiarlo (o la zona horaria, o una ausencia o un horario con
  fecha pasada) la web marca `recalcularDesde` y el worker (`resumen-pendiente`, cada 5 min)
  recalcula el resumen diario. Los textos dejan de decir "laborales" en modo corrido.
- Zona horaria editable por subcuenta en Configuración (la de GHL puede no ser la del país donde
  opera el negocio; Jade18K queda en America/Lima). La carga de GHL no la sobrescribe.
- Las tarjetas y tablas muestran las metas reales de cada subcuenta (antes había valores fijos).
- Pendiente: el filtro por canal de la vista general (§10.2). `resumen_diario` no guarda la
  dimensión canal; agregarla requiere cambiar el resumen del worker y regenerarlo.
