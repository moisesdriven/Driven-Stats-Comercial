# Plan de trabajo

Fases según la sección 14 de `ESPECIFICACION.md`. Se trabaja en la rama
`claude/bold-ptolemy-6m09ny`, con un commit por fase, y se espera aprobación antes de pasar a la
siguiente.

| Fase | Entregable                                                                          | Estado         |
| ---- | ----------------------------------------------------------------------------------- | -------------- |
| 0    | Monorepo, CI, `.env.example`, `CLAUDE.md`, este plan                                | Terminada      |
| 1    | Esquema `comercial`, roles, migraciones, cifrado, `crear-admin`, login y permisos   | Terminada      |
| 2    | Cliente GHL, alta de subcuentas y tokens, cargas; `docs/mapeo-origen.md`            | Terminada      |
| 3    | `packages/core`: horario laboral, indicadores, semáforo, cuello de botella, alertas | Terminada      |
| 4    | Historial de etapas y análisis de calidad por muestra                               | Terminada (\*) |
| 5    | Interfaz: vista general, subcuenta, asesor, horarios, usuarios, configuración       | Terminada      |
| 6    | Purga de textos (alertas y resumen diario por WhatsApp: versión 2)                  | Terminada      |
| 7    | Scripts de despliegue en PowerShell y `docs/DEPLOY.md`                              | Terminada      |

(\*) Construida y validada en costo con análisis reales (estimado a ±1 % del real). La rúbrica v4
aprueba la calibración en los dos conjuntos con Sonnet 5.5 (±1 93–94 %, categoría 85–87 %); con
Haiku 5.5 (valor por omisión) solo al límite en el primero. El modelo lo elige el administrador
global en Configuración › Calidad: ~US$ 8 (Sonnet) frente a ~US$ 0,40 (Haiku) al mes por subcuenta
(ver `validacion.md` y `decisiones.md`, 18 nov 2026).

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
- Filtro por canal de la vista general (§10.2, 18 nov 2026): `resumen_diario.canal` (migración
  0002). El worker guarda, además del total de la subcuenta y las filas por asesor, el total de la
  subcuenta en cada canal; el resto de las consultas usa solo las filas con `canal` nulo. El
  selector muestra los canales con datos en las subcuentas del usuario; con un canal elegido, la
  calidad queda sin dato (no se mide por canal) y la exportación incluye el canal. Al desplegar hay
  que recalcular el resumen (`servidor.sh recalcular 90`) para que existan las filas por canal.
- Rediseño visual aprobado el 18 nov 2026 (ver `decisiones.md`).
- Módulo Asesores propio, metas y etapas explícitamente por subcuenta, elección del modelo de IA
  por el administrador global y navegación más rápida (18 nov 2026, ver `decisiones.md`).

## Fase 6 · resultado

- Decisión del cliente (16 nov 2026): **no hay envío por correo**. Las alertas en tiempo real y el
  resumen diario irán por WhatsApp en la versión 2. Se quitaron las variables SMTP de
  `.env.example`; `MODO_ALERTAS` sigue en `sombra`.
- `purga-textos` (worker, diario a las 03:30 hora de Lima): borra `mensajes.texto` con más de 90
  días, por lotes de 5.000. Conserva el resto del mensaje y las clasificaciones de calidad. También
  a mano: `node dist/cli.js purga`.
- La carga de mensajes ya no guarda ni restaura el texto de un mensaje con más de 90 días, para que
  una recarga histórica no deshaga la purga.
- En la web, un ejemplo de calidad cuyo texto ya se borró lo indica, y "Mensajes para mejorar" solo
  muestra mensajes que aún conservan su texto.

## Fase 7 · resultado

- `scripts/deploy/`: `config.example.psd1`, `comun.ps1` y los scripts `00` a `08` de la §13
  (PowerShell 5.1 y 7, `Set-StrictMode`, pasos numerados, secretos con `Read-Host -AsSecureString`
  que viajan por la entrada estándar de ssh, nunca en la línea de comandos ni en disco local).
- Adaptaciones al servidor real: PostgreSQL propio (`02` entra por el socket local del contenedor,
  sin pedir la contraseña del administrador) y Traefik por etiquetas (no se edita ni se recarga el
  proxy). `Transporte = 'local'` permite ejecutar los scripts en el propio servidor.
- Reversión: `03` guarda las imágenes en marcha como `:anterior` antes de cambiar; `06` vuelve a
  ellas.
- Despliegue de prueba completo (ver `docs/DEPLOY.md`, sección final). Encontró dos errores ya
  corregidos: el worker necesitaba `CREATE` sobre la base para pg-boss (`esquema_y_roles.sql`) y el
  despliegue no detectaba un worker que se reiniciaba.
- CI revisa la sintaxis de los scripts de PowerShell.
- Pendiente: la primera ejecución real por SSH desde Windows contra el servidor.
