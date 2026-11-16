# Mapeo de origen de mensajes y fuentes de GHL

Subcuenta piloto: **Jade18K** (`93mgPQwURqpEvyzZcf9m`). Inspección del 16 de noviembre de 2026,
solo lectura, con el PIT de la subcuenta. Este documento resume patrones de campos: no copia
mensajes de clientes.

> **Estado: pendiente de aprobación.** Las preguntas abiertas están al final.

## 1. Lo que se revisó

| Fuente                                                                                                                    | Muestra                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /conversations/messages/export`                                                                                      | 6.000 mensajes (14–16 nov). El rango de 14 días tiene 48.890 mensajes (unos 3.500 por día). |
| `GET /conversations/{id}/messages`                                                                                        | 40 conversaciones, 310 mensajes (incluye actividades)                                       |
| `GET /conversation-ai/generations`                                                                                        | 200 salientes `source=app` elegidos al azar, más controles                                  |
| `GET /conversations/search`, `/opportunities/search`, `/opportunities/pipelines`, `/opportunities/lost-reason`, `/users/` | Totales y estructura                                                                        |

Volumen de la subcuenta: 12.491 conversaciones y 13.079 oportunidades. 10 usuarios, de los cuales
4 asesoras envían mensajes.

## 2. Hallazgos

### 2.1 Solo hay tres patrones de mensaje de WhatsApp

| Dirección | `source`   | `userId`       | Cantidad en la muestra |
| --------- | ---------- | -------------- | ---------------------- |
| inbound   | —          | vacío          | 1.678                  |
| outbound  | `workflow` | **con userId** | 2.980                  |
| outbound  | `app`      | **con userId** | 1.342                  |

No aparecieron `campaign`, `bulk_actions` ni `api`, aunque la documentación los define.

### 2.2 `userId` no indica que el mensaje sea humano

Los mensajes de workflow traen el `userId` de la asesora asignada (las 4 asesoras aparecen en
proporciones casi iguales). Son 9 plantillas repetidas (bienvenida y recordatorios), y el 47 % no
tiene texto: son imágenes del catálogo. Responden de 4 a 13 segundos después del cliente.

### 2.3 El agente de IA envía con `source=app` y el `userId` de la asesora

Es el hallazgo más importante. En 200 salientes `app` al azar:

| Resultado de `GET /conversation-ai/generations`               | Mensajes   | Demora mediana tras el mensaje del cliente |
| ------------------------------------------------------------- | ---------- | ------------------------------------------ |
| Generación encontrada (`mode: auto-pilot`) → **agente de IA** | 143 (72 %) | 16 s                                       |
| "No Ai suggestion Found" → **humano**                         | 57 (28 %)  | ~32 min                                    |

Si se tomara `source=app` como humano, el 72 % de las respuestas "humanas" serían del agente de IA y
los tiempos de respuesta de las asesoras saldrían falsamente excelentes. La diferencia de tiempos
confirma la clasificación.

El endpoint funcionó con el PIT actual. La especificación (§7) no incluye el permiso
`conversation-ai.readonly`: propongo agregarlo a la lista obligatoria y verificarlo al dar de alta
cada PIT.

### 2.4 Actividades de oportunidad (para el historial de etapas)

`GET /conversations/{id}/messages` incluye mensajes `TYPE_ACTIVITY_OPPORTUNITY` con:

```json
{
  "type": "opportunity_stage_updated",
  "data": {
    "id": "<opportunityId>",
    "status": "open",
    "pipeline": "Flujo Comercial",
    "stage": { "oldStageName": "Nuevo", "newStageName": "Contactado" }
  }
}
```

y `opportunity_created` (solo `newStageName`). Fecha = `dateAdded` del mensaje.

- **Sí** permiten reconstruir el historial de etapas de la carga histórica: oportunidad, etapa de
  origen, etapa de destino y fecha. Las etapas vienen **por nombre**; se traducen a `stage_id` con
  el pipeline (nombre único dentro del pipeline).
- La exportación de mensajes **no** incluye estas actividades. Hay que pedirlas por conversación
  (`type=TYPE_ACTIVITY_OPPORTUNITY`): unas 12.500 llamadas en la carga histórica de Jade18K.
- `TYPE_ACTIVITY_EMPLOYEE_ACTION_LOG` son acciones del empleado de IA (actualizar campos y
  disparar workflows). No se usan.
- En la muestra no aparecieron cambios de estado (ganada o perdida) como actividad. Se verificará
  en la primera carga.

### 2.5 Asignación

- La conversación y la oportunidad traen solo el `assignedTo` **actual**; GHL no da el historial de
  asignaciones.
- La conversación trae `lastManualMessageDate` y `lastInboundWhatsappMessageDate`, útiles para
  controles cruzados.

### 2.6 Oportunidades y etapas

Pipeline único "Flujo Comercial":

| Etapa         | Oportunidades |
| ------------- | ------------- |
| Nuevo         | 6.484         |
| Contactado    | 6.285         |
| Cotizado      | 280           |
| Adelanto      | 12            |
| En Producción | 4             |
| Despachado    | 4             |
| Pago Completo | 10            |

Por estado: 12.388 `open`, **11 `won`**, 677 `lost` y 3 `abandoned`. Hay 6 motivos de pérdida.

**En Jade18K las ventas se registran moviendo de etapa, casi nunca marcando "ganada".** Ver la
pregunta 1.

### 2.7 Detalles técnicos verificados en la documentación oficial

| Grupo                                                                | Header `Version` | Paginación                                                                                                                                    |
| -------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversaciones y mensajes (`/conversations/*`, `/conversation-ai/*`) | `2021-04-15`     | search: `limit` máximo 100 con `startAfterDate`; messages: `lastMessageId` y `nextPage`; export: `limit` de 10 a 500, `cursor` y `nextCursor` |
| Oportunidades, usuarios, subcuentas, contactos                       | `2021-07-28`     | opportunities/search: `page` / `startAfter` + `startAfterId`; lost-reason: `skip` / `limit`                                                   |

- Límites reales (headers): **100 llamadas cada 10 s y 200.000 por día** por subcuenta.
- Cloudflare bloquea clientes sin `User-Agent` propio (error 1010): el cliente enviará
  `driven-comercial/<versión>`.
- `GET /conversations/messages/{id}` no acepta PIT ("Token source/channel mismatch"); no se usa.
- `POST /locations/{id}/tasks/search` respondió con el PIT actual: se usará para las tareas.

## 3. Regla de origen propuesta

Para cada mensaje:

| Condición                                                                                | Origen                                                                                  |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `direction = inbound`                                                                    | cliente (no lleva origen)                                                               |
| `messageType` empieza con `TYPE_ACTIVITY_`                                               | no es mensaje: va a `historial_etapas`                                                  |
| outbound y `source` en (`campaign`, `bulk_actions`)                                      | `campana`                                                                               |
| outbound y `source = workflow`                                                           | `workflow`                                                                              |
| outbound y `source = api`                                                                | `workflow` (automatización externa) — _pregunta 3_                                      |
| outbound, `source = app` y `generations` devuelve una generación                         | `agente_ia`                                                                             |
| outbound, `source = app`, `generations` responde "No Ai suggestion Found" y hay `userId` | **`manual`**                                                                            |
| cualquier otro caso, o si `generations` falla (red, 429, 5xx)                            | `sin_origen` (no se califica ni cuenta como humano; se reintenta en la siguiente carga) |

Costo: una llamada a `generations` por cada saliente `app`, unas 900 por día en Jade18K. En la carga
histórica de 90 días son unas 70.000 llamadas: se reparten respetando el límite de 100 cada 10 s y
dejando margen del límite diario para Driven Conteo.

Un mensaje es "humano" para los indicadores (primera respuesta humana, intentos y calidad) **solo**
si su origen es `manual`.

## 4. Preguntas para aprobar

1. **¿Qué es una venta concretada en Jade18K?** La especificación dice "oportunidad ganada", pero
   aquí solo hay 11. Propuesta: venta = oportunidad `won` **o** que entra a una etapa mapeada como
   "Ganado" en `mapa_etapas` (para Jade18K: Adelanto). La fecha de la venta es la primera entrada a
   esa etapa, según `historial_etapas`, y el monto es `monetaryValue`. ¿Cuál etapa cuenta como
   venta: **Adelanto** (pagó adelanto) o **Pago Completo**?
2. **Mapa de etapas de Jade18K** a las estándar. Propuesta: Nuevo → Nuevo; Contactado → Contactado;
   Cotizado → Por cerrar; Adelanto, En Producción, Despachado y Pago Completo → Ganado. Ninguna
   etapa queda como "Interesado". Como las reglas de seguimiento (§3) usan "Interesado o Por cerrar"
   juntas, Cotizado queda cubierta. Se puede cambiar desde la pantalla de configuración.
3. ¿Mensajes con `source = api` como `workflow` (automático)? No aparecieron en Jade18K.
4. Modo "sugerencia" de la IA (la asesora envía un texto que propuso la IA): no apareció; solo
   `auto-pilot`. Propuesta: si aparece, contarlo como `agente_ia`, porque el texto lo escribió la IA.
5. **Asignación al ingreso:** como GHL no guarda el historial, el sistema registrará el asesor
   asignado la primera vez que ve el lead (cargas cada 15 minutos). En la carga histórica se usará el
   asignado actual. Si no hay asignado, se usa el autor de la primera respuesta `manual` (§3).
6. Agregar `conversation-ai.readonly` a los permisos obligatorios del PIT (§7).
