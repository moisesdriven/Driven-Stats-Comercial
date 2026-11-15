# Driven Comercial — Especificación del sistema

Versión 1.0 · 15 de noviembre de 2026

Sistema interno de Driven para medir la eficiencia de los equipos comerciales de **todas las subcuentas de GoHighLevel (GHL)**: desde que ingresa un lead hasta que se concreta o se pierde la venta. Este documento es la fuente de verdad para construirlo.

---

## 1. Objetivo y alcance

**Objetivo.** Medir por asesor, subcuenta y agencia 8 indicadores comerciales, agruparlos en 4 etapas (atención, seguimiento, negociación, cierre) y señalar dónde está el cuello de botella. Los indicadores se leen juntos, nunca aislados.

La evaluación responde cuatro preguntas:

1. **Velocidad:** ¿el asesor responde a tiempo?
2. **Gestión:** ¿atiende y da seguimiento a todos sus leads?
3. **Efectividad:** ¿convierte las oportunidades en ventas?
4. **Productividad:** ¿consigue resultados en el menor tiempo posible?

**Alcance de la versión 1**

- Todas las subcuentas de la agencia (hoy: ECOM - Bria Import, Driven IA 1, Ecommerce, Driven Automations). Una subcuenta nueva se agrega desde la interfaz y entra en la siguiente carga.
- Dos vistas: **general** (todas las subcuentas) y **por subcuenta**, con detalle por asesor.
- Solo lectura sobre GHL: el sistema nunca escribe ni envía nada en GHL.
- Fuera de alcance: llamadas telefónicas, correos masivos de campañas, alertas por WhatsApp (quedan para una versión 2).

---

## 2. Decisiones de arquitectura (no cambiar sin consultar)

| Decisión | Detalle |
| --- | --- |
| Proyecto independiente | Repositorio propio (`driven-comercial`). **No** es un módulo de Driven Conteo, que pertenece a otro equipo. |
| Misma instancia PostgreSQL | Usa el servidor PostgreSQL existente (el mismo de Driven Conteo), pero **solo su propio esquema `comercial`**. |
| Aislamiento total de Conteo | Roles propios (`comercial_web`, `comercial_worker`, `comercial_migrador`) con permisos solo sobre `comercial` y `comercial_cola`. Sin acceso a los esquemas `ghl` ni `app` de Conteo. Ningún secreto compartido. |
| Stack | El mismo de Driven Conteo: monorepo Node 22 + pnpm 10, Next.js (UI + API propia), worker con pg-boss, Drizzle ORM + migraciones, Docker, imágenes en GHCR, CI en GitHub Actions. |
| Cola de trabajos | pg-boss en su propio esquema `comercial_cola`. |
| Migraciones | Drizzle gestiona **solo** el esquema `comercial` (`schemaFilter: ['comercial']`). |
| Credenciales GHL | Propias de este proyecto: un token de agencia (listar subcuentas) y un PIT de solo lectura por subcuenta, guardados cifrados (AES-256-GCM con clave en variable de entorno). |
| IA para calidad de mensajes | API de Anthropic (Claude). Modelo configurable por variable de entorno (por defecto un modelo Haiku vigente, por costo). |

### Estructura del repositorio

```
apps/web         Next.js: vistas, API propia, login, administración
apps/worker      Cargas desde GHL, cálculo diario, clasificación IA, alertas, purga
packages/core    Reglas de negocio puras con pruebas (indicadores, horario laboral, semáforo, cuello de botella)
packages/ghl     Cliente de la API de GHL (límite de ráfaga, reintentos con backoff, paginación, verificación de permisos)
packages/db      Esquema Drizzle `comercial`, migraciones, cifrado de tokens
packages/ui      Componentes y tokens de diseño
docker/          Dockerfiles de web y worker, docker-compose de producción
scripts/deploy   Scripts de despliegue en PowerShell
scripts/sql      Creación de esquemas y roles (se ejecuta una vez, con aprobación)
docs/            Arquitectura, runbooks, DEPLOY.md, mapeos
```

---

## 3. Definiciones operativas

Todos los umbrales son **parámetros por subcuenta** editables desde la interfaz.

| Término | Definición | Regla con datos de GHL |
| --- | --- | --- |
| Lead | Contacto cuya conversación tiene su primer mensaje entrante dentro del periodo. | Primer mensaje con `direction = inbound`. |
| Ingreso del lead | Fecha y hora del primer mensaje entrante. | `dateAdded` del primer inbound. |
| Primera respuesta | Primer mensaje saliente posterior al ingreso. Se guarda por separado la automática (workflow o agente IA) y la humana (enviada por un usuario). **Los indicadores del asesor usan la humana.** | Primer outbound; origen según §6.3. |
| Tiempo de respuesta | Minutos **laborales** entre el ingreso y la primera respuesta humana (ver §4). | |
| Lead sin responder | Lead que no ha recibido ninguna respuesta humana. Aparte: “en espera”, leads ya atendidos cuyo último mensaje del cliente lleva más de 15 min laborales sin respuesta. | |
| Pendiente de seguimiento | Lead con oportunidad abierta en etapa Interesado o Por cerrar, cuyo último saliente tiene más de 1 día laboral del asesor, o con tarea de seguimiento vencida. | Oportunidad `status = open` + etapa estándar + último outbound + tareas. |
| Intento de contacto | Bloque de mensajes salientes seguidos enviados sin que el cliente responda el anterior. Se cuentan bloques, no mensajes sueltos. | |
| Respuesta efectiva | Primera respuesta humana dentro del SLA (5 min laborales por defecto) tras la cual el cliente vuelve a escribir. | Existe un inbound posterior a la primera respuesta. |
| Venta concretada | Oportunidad marcada como ganada. | `status = won`; fecha = `lastStatusChangeAt`; monto = `monetaryValue`. |
| Lead perdido | Oportunidad perdida o abandonada. | `status in (lost, abandoned)` + `lostReasonId`. |
| Abandono | El cliente deja de responder: último mensaje saliente, sin inbound por 72 h y sin venta. | |
| Perdido por falta de seguimiento | Lead perdido o abandonado cuyo último mensaje fue del cliente y quedó sin respuesta, o que recibió menos de 2 intentos después de quedar en silencio. | |
| Interesado de días anteriores | Lead en etapa Interesado o Por cerrar cuyo último contacto fue antes de hoy. | |

**Atribución al asesor**

- Tiempo de respuesta, sin responder y calidad: el asesor asignado a la conversación al momento del ingreso (si no hay, el usuario que envió la primera respuesta humana).
- Ventas, tiempo de cierre y perdidos: el asesor asignado a la oportunidad al cambiar de estado.
- Un mismo usuario de GHL en varias subcuentas se identifica por su `userId`: se suma en la vista general y se separa en cada subcuenta.

**Etapas estándar del pipeline:** Nuevo, Contactado, Interesado, Por cerrar, Ganado, Perdido. Cada etapa real de cada pipeline se mapea a una estándar en la tabla `mapa_etapas` (pantalla de configuración).

---

## 4. Horario laboral por asesor

Todos los tiempos (respuesta, espera, seguimiento, cierre) se miden en **tiempo laboral del asesor**, no en horas de reloj.

- Cada asesor tiene un horario **por subcuenta**: días de la semana con uno o más tramos (ej. 9:00–13:00 y 15:00–19:00), con fechas de vigencia.
- Se usa el horario del asesor atribuido al lead; si no hay asesor, el horario general de la subcuenta.
- Un lead que entra fuera de horario empieza a contar al inicio del siguiente tramo laboral.
- Feriados (de toda la subcuenta) y vacaciones o permisos (por asesor) se registran como ausencias y no cuentan.
- Las alertas en tiempo real solo se envían dentro del horario del asesor.
- La zona horaria es la de la subcuenta (por defecto `America/Lima`).
- GHL no guarda la jornada: se carga en el sistema.

Implementar en `packages/core`:

- `minutosLaborales(inicio, fin, horario, ausencias, zonaHoraria): number`
- `sumarTiempoLaboral(inicio, minutos, horario, ausencias, zonaHoraria): Date` (para vencimientos de “1 día laboral”)
- `diasLaborales(inicio, fin, ...)` (1 día laboral = la duración de la jornada de ese asesor en ese día).

Pruebas obligatorias: tramos partidos, intervalos que cruzan varios días, lead fuera de horario, fin de semana, feriado, vacaciones, cambio de horario por vigencia y cambio de horario de verano (aunque Lima no lo use, la función debe ser correcta con cualquier zona).

---

## 5. Indicadores, preguntas y lógica de evaluación

### 5.1 Los 8 indicadores (fórmulas del área comercial)

| # | Indicador | Cálculo |
| --- | --- | --- |
| 1 | Tiempo de respuesta | Hora de primera respuesta humana − hora de ingreso del lead, en minutos laborales. Se reporta mediana (principal) y promedio. |
| 2 | Calidad de los mensajes | Puntaje promedio 1–5 de los mensajes salientes humanos (§6). Distribución por categoría. |
| 3 | Leads sin responder | Conteo de leads sin primera respuesta humana (más el conteo aparte de “en espera”). |
| 4 | Leads pendientes de seguimiento | Conteo de leads que requieren seguimiento (§3). |
| 5 | Tasa de conversión | (Ventas concretadas en el periodo ÷ leads recibidos en el periodo) × 100. Se guarda también la conversión por cohorte (ventas de los leads del periodo) para análisis. |
| 6 | Promedio de cierre | **Ambos:** tiempo promedio de cierre = suma de tiempos de cierre (ingreso → ganada, en días laborales) ÷ ventas concretadas; y ticket promedio = suma de montos ÷ ventas concretadas. |
| 7 | Ventas concretadas | Conteo (y monto) de oportunidades ganadas en el periodo, por día y por asesor. |
| 8 | Leads perdidos | Conteo de oportunidades perdidas o abandonadas, con motivo; aparte, perdidos por falta de seguimiento. |

### 5.2 Las 12 preguntas que debe responder el sistema

| Pregunta | Cómo se responde |
| --- | --- |
| ¿Cuál es el tiempo promedio de respuesta al primer mensaje de un lead? | Indicador 1. |
| ¿Qué tipo de mensajes está enviando a los clientes? | Indicador 2: distribución por categoría + mejor y peor mensaje del periodo. |
| ¿Cuántos leads tiene actualmente sin responder? | Indicador 3, en tiempo real. |
| ¿Cuántos leads están pendientes de seguimiento? | Indicador 4, en tiempo real. |
| ¿Cuántos intentos de contacto realiza por lead? | Promedio de intentos por lead + distribución (0, 1, 2, 3+). |
| ¿Cuál es el promedio de cierre de ventas? | Indicador 6 (días laborales y ticket). |
| ¿Cuántos leads se convierten en ventas? | Indicador 5. |
| ¿Cuántos clientes abandonan la conversación sin concretar una compra? | Conteo de abandonos (§3) + oportunidades `abandoned`. |
| ¿Cuántas ventas concreta diariamente? | Indicador 7 por día + promedio diario. |
| ¿Cuántos leads se pierden por falta de seguimiento? | Perdidos por falta de seguimiento (§3). |
| ¿Está realizando seguimiento a los clientes interesados de días anteriores? | % de interesados de días anteriores que recibieron un saliente humano hoy. “Sí” si alcanza la meta (80 % por defecto). |
| ¿Qué porcentaje de leads recibe una respuesta efectiva? | Leads con respuesta efectiva ÷ leads del periodo × 100. |

### 5.3 Etapas, semáforo y cuello de botella

| Etapa | Pregunta | Indicadores que la componen |
| --- | --- | --- |
| 1. Atención | Velocidad | Tiempo de respuesta, leads sin responder |
| 2. Seguimiento | Gestión | Cumplimiento de seguimiento a interesados, pendientes, intentos por lead, perdidos por falta de seguimiento |
| 3. Negociación | Efectividad | Calidad de mensajes, respuesta efectiva, abandonos |
| 4. Cierre | Productividad | Tasa de conversión, tiempo de cierre, ventas frente a meta |

Ticket promedio y leads perdidos totales son de referencia (sin semáforo).

**Semáforo por indicador** (tolerancia configurable, 20 % por defecto):

- Más es mejor: `ratio = valor / meta`. Verde si ≥ 1; amarillo si ≥ 0,8; rojo si < 0,8.
- Menos es mejor: `ratio = meta / valor` (valor 0 = verde).
- Metas en cero (sin responder, pendientes, perdidos por falta de seguimiento): verde si 0; amarillo hasta una tolerancia absoluta configurable; rojo si la supera.

**Metas por defecto de cada subcuenta:** tiempo de respuesta 5 min · sin responder 0 (tolerancia 2) · pendientes 0 (tolerancia 3) · cumplimiento de seguimiento 80 % · intentos por lead ≥ 2 · perdidos por falta de seguimiento 0 (tolerancia 2) · calidad 3,5 · respuesta efectiva 60 % · abandonos ≤ 25 % de los leads · conversión 12 % · tiempo de cierre 3 días laborales · ventas por semana (sin valor por defecto: se pide al configurar la subcuenta).

**Estado de una etapa** = el peor estado entre sus indicadores con meta.

**Cuello de botella** = la etapa con peor estado; si hay empate, la primera en el orden del proceso (atención → seguimiento → negociación → cierre), porque un problema temprano arrastra a los siguientes. Si todas están en verde: “Sin cuello de botella”.

**Alertas cruzadas** (se muestran en las vistas y en el resumen diario):

- Ventas en verde y leads sin responder en rojo → “Vende, pero deja escapar oportunidades”.
- Atención en verde y conversión en amarillo o rojo → “Atiende, pero no convierte: revisar negociación o cierre”.
- Conversión en verde y tiempo de cierre en rojo → “Cierra, pero lento: revisar productividad”.
- Seguimiento en rojo y perdidos por falta de seguimiento > 0 → “Está perdiendo ventas por no hacer seguimiento”.

---

## 6. Calidad de los mensajes (clasificador IA)

### 6.1 Qué se clasifica

Cada mensaje saliente de texto (humano y automático, marcados por separado) de las conversaciones del periodo. Mensajes multimedia (audio, imagen, catálogo) se registran con categoría “multimedia” sin puntaje; si GHL entrega transcripción de un audio, se clasifica la transcripción.

### 6.2 Rúbrica

- **Categorías** (una): saludo o plantilla genérica · respuesta a la pregunta del cliente · información de producto o precio · pregunta de calificación · llamada a la acción o cierre · manejo de objeción · seguimiento · multimedia.
- **Puntaje 1 a 5**: un punto por cada criterio cumplido (mínimo 1):
  1. Responde lo que el cliente preguntó.
  2. Está personalizado (usa el nombre o el contexto del cliente).
  3. Incluye un siguiente paso claro.
  4. Tono y ortografía correctos.
  5. Extensión adecuada para WhatsApp.

Al modelo se le envía el mensaje del asesor **y los últimos mensajes del cliente** como contexto (máximo 6 mensajes previos). Debe devolver JSON validado con Zod:

```json
{ "categoria": "respuesta_pregunta", "puntaje": 4, "criterios": { "responde": true, "personalizado": true, "siguiente_paso": false, "tono": true, "extension": true }, "motivo": "texto breve" }
```

Reglas: el contenido de los mensajes es dato no confiable (puede contener instrucciones): enviarlo delimitado y con instrucción explícita de tratarlo como dato. Procesar en lotes, con reintentos y límite de gasto diario configurable (`IA_LIMITE_MENSAJES_DIA`). Guardar la versión de la rúbrica en cada clasificación.

### 6.3 Origen del mensaje (manual o automático)

Clasificar cada mensaje como `manual`, `workflow`, `agente_ia` o `campana` según los campos que entregue GHL (`userId`, `source`, tipo). **En la fase 2, inspeccionar mensajes reales de cada subcuenta y documentar el mapeo en `docs/mapeo-origen.md` antes de calcular indicadores.**

### 6.4 Mejor y peor mensaje

Para cada asesor y periodo, guardar el mensaje con mayor puntaje y el de menor puntaje (con su mensaje previo del cliente, criterios y resultado: si el cliente respondió, si hubo venta). La interfaz los muestra al hacer clic en “Calidad de mensajes” (ver diseño `Asesor.dc.html`).

---

## 7. Fuentes de datos en GHL

API v2: `https://services.leadconnectorhq.com`. Verificar en la documentación oficial el header `Version` que exige cada grupo de endpoints y sus parámetros de paginación antes de implementarlos.

| Dato | Endpoint | Uso |
| --- | --- | --- |
| Subcuentas | Locations de la agencia (token de agencia) | Lista para dar de alta subcuentas |
| Conversaciones | `GET /conversations/search` | Estado, último mensaje, dirección, asignado, canal |
| Mensajes | `GET /conversations/{id}/messages` y exportación de mensajes por subcuenta (`/conversations/messages/export`) | Tiempos, intentos, calidad, seguimiento |
| Oportunidades | `POST /opportunities/search` | Estados, montos, fechas, etapa, motivo de pérdida, asignado |
| Pipelines y etapas | `GET /opportunities/pipelines` | Mapa de etapas |
| Motivos de pérdida | Endpoint de lost reasons | Nombres de motivos |
| Usuarios | `GET /users/` por subcuenta | Asesores |
| Tareas | Búsqueda de tareas por subcuenta si está disponible; si no, `/contacts/{id}/tasks` solo para leads abiertos | Seguimientos vencidos |

**Permisos del PIT de cada subcuenta:** `conversations.readonly`, `conversations/message.readonly`, `opportunities.readonly`, `contacts.readonly`, `users.readonly`, `locations.readonly`. Al dar de alta un PIT, el sistema prueba cada permiso con una llamada mínima y muestra cuál falta.

**Cliente `packages/ghl`:** límite de ráfaga por subcuenta, respeta los headers de límite de la API, reintenta 429 y 5xx con backoff exponencial y jitter, pagina hasta el final, registra cada llamada (sin tokens) para auditoría. Como Driven Conteo consulta las mismas subcuentas, las cargas pesadas se programan en horario distinto (configurable).

**Estrategia de carga**

- Carga histórica inicial: últimos 90 días por subcuenta (comando manual).
- Incremental cada 15 min: conversaciones con actividad desde la última marca de agua, sus mensajes nuevos, oportunidades actualizadas.
- Completa nocturna: reconciliación de oportunidades y usuarios, recálculo del día anterior.
- Todas las escrituras son upsert idempotentes por id de GHL.

---

## 8. Modelo de datos (esquema `comercial`)

Todas las tablas llevan `location_id` cuando aplica, `creado_en` y `actualizado_en`.

| Tabla | Una fila por | Columnas clave |
| --- | --- | --- |
| `subcuentas` | Subcuenta | location_id (PK), nombre, zona_horaria, activa, horario_general (jsonb), metas (jsonb), umbrales (jsonb) |
| `credenciales` | Subcuenta + una de agencia | location_id, tipo (agencia/subcuenta), token_cifrado, permisos_verificados (jsonb), verificado_en |
| `asesores` | Usuario de GHL | user_id (PK), nombre, correo |
| `asesor_subcuenta` | Asesor en una subcuenta | user_id, location_id, activo |
| `horarios` | Tramo de jornada | id, user_id (nulo = horario general), location_id, dia_semana (1–7), hora_inicio, hora_fin, vigente_desde, vigente_hasta |
| `ausencias` | Feriado, vacaciones o permiso | id, user_id (nulo = toda la subcuenta), location_id, inicio, fin, tipo, motivo |
| `mapa_etapas` | Etapa de un pipeline | location_id, pipeline_id, stage_id, nombre_original, etapa_estandar |
| `leads` | Conversación de un contacto | location_id, conversation_id (PK), contact_id, opportunity_id, canal, asesor_id, ingreso_en, primera_resp_auto_en, primera_resp_humana_en, minutos_laborales_respuesta, ultimo_inbound_en, ultimo_outbound_en, intentos, respuesta_efectiva, abandono, estado, etapa_estandar |
| `mensajes` | Mensaje | message_id (PK), location_id, conversation_id, direccion, tipo, origen, user_id, texto (se purga a los 90 días), fecha. **Particionada por mes en `fecha`.** |
| `oportunidades` | Oportunidad | opportunity_id (PK), location_id, contact_id, pipeline_id, stage_id, status, monto, creada_en, cambio_estado_en, motivo_perdida, asesor_id |
| `tareas` | Tarea | task_id (PK), location_id, contact_id, vence_en, completada |
| `clasificaciones` | Mensaje saliente clasificado | message_id (PK), categoria, puntaje, criterios (jsonb), motivo, modelo, version_rubrica |
| `resumen_diario` | Día × subcuenta × asesor | fecha, location_id, asesor_id (nulo = toda la subcuenta), indicadores (jsonb), estados_etapa (jsonb), cuello_botella, alertas (jsonb) |
| `ejemplos_calidad` | Asesor × periodo | asesor_id, location_id, periodo, mejor_message_id, peor_message_id |
| `usuarios` | Persona con acceso | id, correo, nombre, hash (Argon2id), rol (`admin`, `dueno`, `supervisor`, `asesor`), activo, totp_secreto_cifrado, debe_cambiar_clave, ultimo_ingreso |
| `usuario_subcuenta` | Subcuenta asignada a un usuario | usuario_id, location_id (un usuario puede tener varias) |
| `permisos_rol` | Rol × módulo | rol, modulo, nivel (`ninguno`, `ver`, `editar`); se siembra con la matriz de §10.1 |
| `permisos_usuario` | Excepción por usuario | usuario_id, modulo, nivel (reemplaza al del rol) |
| `usuario_asesor` | Vínculo asesor ↔ usuario | usuario_id, user_id de GHL |
| `auditoria` | Acción relevante | quien, que, cuando, detalle |
| `sync_estado` | Subcuenta × recurso | location_id, recurso, marca_agua, ultimo_ok, ultimo_error |

Índices mínimos: `leads(location_id, ingreso_en)`, `leads(asesor_id, ingreso_en)`, `mensajes(conversation_id, fecha)`, `oportunidades(location_id, status, cambio_estado_en)`, `resumen_diario(fecha, location_id)`.

La vista general **siempre** se calcula sumando los datos de las subcuentas (nunca un cálculo aparte) y los promedios generales se calculan sobre todos los registros, no como promedio de promedios.

---

## 9. Jobs del worker

| Job | Frecuencia | Qué hace |
| --- | --- | --- |
| `sync:incremental` | Cada 15 min | Conversaciones, mensajes y oportunidades nuevas o actualizadas por subcuenta |
| `sync:nocturno` | Diario, 02:30 hora de Lima (configurable) | Reconciliación completa, usuarios, pipelines, tareas |
| `sync:historico` | Manual | Carga de N días (por defecto 90) |
| `calcular:leads` | Tras cada sync | Recalcula campos derivados de los leads tocados |
| `calcular:resumen` | Cada 15 min (hoy) y nocturno (ayer) | `resumen_diario`, estados, cuello de botella, alertas cruzadas |
| `ia:clasificar` | Cada 15 min | Clasifica salientes pendientes respetando el límite diario |
| `alertas:tiempo_real` | Cada 5 min | Leads sin responder > 15 min laborales dentro del horario del asesor (sin duplicar avisos) |
| `alertas:resumen_diario` | 08:00 hora de cada subcuenta | Correo a los supervisores y dueños de negocio de cada subcuenta, y a los administradores |
| `purga:textos` | Diario | Borra `mensajes.texto` con más de 90 días (conserva clasificaciones) |
| `tokens:verificar` | Diario | Verifica permisos de todos los PIT y avisa si alguno falla |

Modos `sombra` (calcula y registra sin enviar alertas) y `activo`, por variable de entorno.

---

## 10. Interfaz y permisos

### 10.1 Roles, subcuentas y módulos

El acceso se controla en tres capas, todas administradas por el **administrador** desde la pantalla “Usuarios y accesos”:

1. **Rol** del usuario (define los módulos por defecto).
2. **Subcuentas asignadas** (define qué datos ve). Un usuario puede tener una o varias subcuentas.
3. **Módulos** con nivel `ninguno`, `ver` o `editar`. El rol da los valores por defecto y el administrador puede activar o quitar módulos a cada usuario (excepción por usuario).

| Rol | Subcuentas | Descripción |
| --- | --- | --- |
| `admin` (Administrador) | Todas, siempre | Todo el sistema, incluidos usuarios, accesos, subcuentas, tokens y configuración. No se puede eliminar ni degradar al último administrador. |
| `dueno` (Dueño de negocio) | Una o varias asignadas por el administrador | Ve su propia “vista general”, que suma **solo sus subcuentas**, además de cada subcuenta y sus asesores. Puede editar metas de sus subcuentas. |
| `supervisor` | Las asignadas | Operación diaria: listas para actuar, asesores y horarios de sus subcuentas. |
| `asesor` | Las asignadas, vinculado a su `userId` de GHL | Solo su propio detalle e indicadores. |

Matriz de módulos por defecto (`e` = editar, `v` = ver, vacío = sin acceso):

| Módulo | admin | dueno | supervisor | asesor |
| --- | --- | --- | --- | --- |
| Vista general (de sus subcuentas) | e | v | | |
| Vista por subcuenta | e | v | v | |
| Detalle de asesores | e | v | v | v (solo el propio) |
| Texto de mensajes | v | v | v | v (solo los propios) |
| Horarios y ausencias | e | v | e | v (solo el propio) |
| Metas y umbrales | e | e | v | |
| Exportar | v | v | | |
| Subcuentas, tokens y mapa de etapas | e | | | |
| Usuarios y accesos | e | | | |

Reglas obligatorias:

- **Cada consulta** de la API y del servidor filtra por las subcuentas del usuario (y por su `userId` de GHL si es asesor). Nunca se confía en el filtro del navegador. Probar con pruebas de integración que un dueño no puede leer datos de una subcuenta que no tiene asignada, aunque cambie la URL.
- El menú solo muestra los módulos a los que el usuario tiene acceso; una URL a un módulo sin permiso responde 403.
- Los cambios de rol, subcuentas y módulos quedan en `auditoria` (quién, a quién, qué cambió).
- Los cambios de permisos se aplican en la siguiente petición del usuario (no esperar a que vuelva a iniciar sesión).

Login con correo y contraseña (Argon2id), sesión en cookie `httpOnly` + `SameSite=Lax` + `Secure`, 2FA TOTP opcional, sin registro público, contraseña temporal que debe cambiarse al primer ingreso. Permisos validados en el servidor en cada página y cada endpoint. Comando `crear-admin` para el primer usuario.

### 10.2 Pantallas

1. **Vista general** (`/`): resumen por etapa con semáforo y cuello de botella de la agencia, 8 indicadores, tabla de subcuentas (indicadores + semáforo por etapa + cuello de botella), ventas por día, alertas cruzadas. Filtros: periodo (hoy, 7 días, mes, rango), canal.
2. **Vista por subcuenta** (`/subcuentas/[id]`): indicadores, tabla por asesor con cuello de botella, listas para actuar (sin responder, pendientes, interesados de ayer sin contacto hoy) con enlace a la conversación en GHL, motivos de pérdida, mensajes con menor puntaje.
3. **Detalle del asesor** (`/subcuentas/[id]/asesores/[userId]`): cuello de botella en una frase, 4 etapas frente a meta y promedio de la subcuenta, horario de hoy, 8 indicadores, distribución de intentos, tipos de mensajes, panel de mejor y peor mensaje al hacer clic en calidad.
4. **Horarios** (`/horarios`): semana por asesor con tramos, horas por semana, agregar o editar tramos, copiar a otro asesor, ausencias y feriados.
5. **Usuarios y accesos** (`/usuarios`, solo admin; diseño `Usuarios.dc.html`): resumen por rol, lista de usuarios (rol, subcuentas, último ingreso) y panel de edición con rol, subcuentas con acceso (selección múltiple; el administrador ve todas), módulos con ver/editar y excepciones por usuario, restablecer contraseña y desactivar usuario.
6. **Configuración** (`/configuracion`, admin): subcuentas y tokens (alta asistida con verificación de permisos), metas y umbrales por subcuenta, mapa de etapas, estado de las cargas.

La **vista general** se muestra al administrador con todas las subcuentas y al dueño de negocio solo con las suyas (con el mismo diseño).

Enlace a la conversación en GHL: `https://app.gohighlevel.com/v2/location/{locationId}/conversations/conversations/{conversationId}` (verificar el formato con la cuenta real; si la agencia usa dominio de marca blanca, hacerlo configurable).

### 10.3 Diseño visual

Los archivos de `diseno/` son la referencia visual aprobada (estructura, jerarquía, estilos inline). Son artboards de un editor de diseño (`.dc.html`): no se ejecutan tal cual (dependen de un runtime `support.js` que no viene incluido), pero el HTML y los estilos se leen directamente. Replicarlos en componentes React con Tailwind o CSS Modules.

Tokens:

| Token | Valor |
| --- | --- |
| Azul eléctrico (primario) | `#1F5BFF`; hover `#0B3FD9`; claro `#4D7CFF`; fondo suave `#E8EEFF` |
| Negro degradado (menú, paneles destacados) | `linear-gradient(180deg, #0B0D12 0%, #1B2030 100%)`; en tarjetas `135deg` |
| Blanco degradado (área de trabajo) | `linear-gradient(180deg, #FFFFFF 0%, #EEF2F9 100%)`; tarjetas `#FFFFFF → #F7F9FD` |
| Texto | principal `#0B0D12`; secundario `#5B6475`; sobre oscuro `#FFFFFF` / `#B4BCCC` |
| Bordes | `#E3E8F2`; filas `#EDF0F6` |
| Semáforo | verde `#12B76A` (fondo `#E7F8EF`, texto `#067647`); amarillo `#F79009` (`#FEF3E2`, `#93370D`); rojo `#F04438` (`#FDECEA`, `#B42318`) |
| Tipografía | Títulos Space Grotesk 600–700; texto Inter 400–600 |
| Radios | botones 10 px; tarjetas 16 px; secciones 18–20 px; píldoras 999 px |

Accesibilidad: contraste mínimo 4,5:1, objetivos táctiles de 44 px, botones y enlaces reales, `aria-label` en botones de solo icono, el semáforo siempre acompañado de texto (no solo color). Responsive: el menú lateral se apila en móvil y las tablas anchas se desplazan dentro de su caja.

---

## 11. Seguridad

- Ningún secreto en el repositorio: solo `.env` local y secretos del servidor/GitHub. Incluir `.env.example`.
- El navegador nunca recibe tokens de GHL, la clave de Anthropic ni credenciales de la base.
- Tokens cifrados en la base; la clave de cifrado solo en variables de entorno.
- Cabeceras de seguridad y CSP estricta en la web.
- Texto de mensajes visible solo para roles con acceso a esa subcuenta; purga a los 90 días.
- Auditoría de inicios de sesión, cambios de configuración, alta de tokens y exportaciones.

---

## 12. Pruebas y criterios de aceptación

- Pruebas unitarias en `packages/core` para cada indicador, horario laboral, semáforo, cuello de botella y alertas cruzadas (casos borde incluidos).
- Pruebas de integración con PostgreSQL desechable (`DATABASE_URL_TEST`) y GHL simulado (nunca tokens reales en pruebas).
- Prueba de punta a punta (Playwright): login, cambio de contraseña obligatorio, alta de subcuenta con PIT simulado, vistas general, subcuenta y asesor, panel de mejor y peor mensaje, edición de horarios, permisos por rol.
- CI: formato, lint, typecheck, tests y build en cada PR; en `main` publica `driven-comercial-web` y `driven-comercial-worker` en GHCR.
- **Validación con datos reales:** para 20 leads por subcuenta, comparar a mano con GHL el ingreso, la primera respuesta, los intentos y el estado. Documentar el resultado en `docs/validacion.md`.

---

## 13. Despliegue (requisito: scripts de PowerShell)

El despliegue se hace **desde una PC con Windows, solo con scripts de PowerShell** (OpenSSH de Windows: `ssh` y `scp`), hacia el servidor donde ya corre Driven Conteo.

Entregar en `scripts/deploy/`:

| Script | Qué hace |
| --- | --- |
| `config.example.psd1` | Plantilla de configuración: servidor, puerto SSH, usuario, ruta remota (`/opt/driven-comercial`), dominio, imágenes, etiqueta |
| `00-verificar-requisitos.ps1` | Local: PowerShell 7 o 5.1, ssh, scp, git. Remoto: SO, Docker, Docker Compose, espacio en disco, memoria, puerto libre, acceso a PostgreSQL |
| `01-preparar-servidor.ps1` | Crea la carpeta remota, sube `docker-compose.prod.yml` y genera el `.env` remoto con permisos 600 (pide los secretos con `Read-Host -AsSecureString`, nunca los escribe en disco local) |
| `02-crear-esquema-y-roles.ps1` | Sube y ejecuta `scripts/sql/esquema_y_roles.sql` (crea `comercial`, `comercial_cola` y los 3 roles). Pide confirmación explícita y la contraseña de administrador de PostgreSQL en el momento. Idempotente |
| `03-desplegar.ps1` | `-Origen GHCR` (descarga la imagen publicada por CI) o `-Origen Local` (build local → `docker save` → envío por `ssh` → `docker load`). Ejecuta migraciones con el rol migrador, levanta los servicios con `docker compose up -d` y espera el healthcheck |
| `04-crear-admin.ps1` | Ejecuta `crear-admin` dentro del contenedor web |
| `05-verificar.ps1` | Estado de contenedores, `/api/salud`, últimas líneas de logs, estado de las cargas |
| `06-revertir.ps1` | Vuelve a la etiqueta anterior guardada en el servidor |
| `07-respaldo.ps1` | `pg_dump -n comercial` comprimido y descarga a la PC |
| `08-carga-historica.ps1` | Lanza `sync:historico` para una o todas las subcuentas |

Requisitos de los scripts: parámetros con valores por defecto desde `config.psd1`, `Set-StrictMode -Version Latest`, `$ErrorActionPreference = 'Stop'`, mensajes en español con cada paso numerado, salida clara de éxito o error, sin contraseñas en la línea de comandos ni en el historial, compatibles con Windows PowerShell 5.1 y PowerShell 7.

En el servidor:

- Contenedores `comercial-web` y `comercial-worker` en su propia red de Docker; la web escucha solo en `127.0.0.1:<puerto>` (por defecto 3100, verificar que no choque con Conteo).
- Publicación por el proxy inverso que ya use el servidor (Nginx, Caddy o Traefik: detectarlo) en un subdominio (ej. `comercial.<dominio>`) con HTTPS. El script muestra el bloque de configuración a agregar y pide confirmación antes de recargar el proxy.
- No modificar nada de Driven Conteo (contenedores, red, proxy existente, esquemas).

Entregar `docs/DEPLOY.md`: guía paso a paso para alguien sin experiencia, con cada comando de PowerShell listo para copiar, qué debe verse en pantalla y qué hacer si falla. Incluir la primera instalación, actualizaciones, reversión y respaldo.

---

## 14. Plan por fases

| Fase | Entregable | Validación |
| --- | --- | --- |
| 0 | Repositorio, monorepo, CI, `.env.example`, `CLAUDE.md`, `docs/PLAN.md` | CI en verde |
| 1 | Esquema `comercial`, roles, migraciones, cifrado, `crear-admin`, login y roles | Pruebas de integración |
| 2 | Cliente GHL, alta de subcuentas y tokens, cargas incremental, nocturna e histórica; `docs/mapeo-origen.md` | Carga real en una subcuenta en modo sombra |
| 3 | `packages/core`: horario laboral, 8 indicadores, semáforo, cuello de botella, alertas cruzadas | Pruebas unitarias + `docs/validacion.md` |
| 4 | Clasificador IA y mejor/peor mensaje | 100 mensajes reales revisados a mano |
| 5 | Interfaz: vista general, subcuenta, asesor, horarios, configuración | Prueba de punta a punta |
| 6 | Alertas (tiempo real y resumen diario) y purga | Modo sombra 3 días |
| 7 | Scripts de despliegue y `docs/DEPLOY.md` | Despliegue de prueba documentado |
