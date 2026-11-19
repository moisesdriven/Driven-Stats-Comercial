# Decisiones iniciales

Las preguntas iniciales de `PROMPT.md` se resolvieron con la opción recomendada. Las marcadas
**por confirmar** dependen de datos del servidor.

| #   | Pregunta                   | Decisión                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Subcuenta piloto           | **Jade18K** (`locationId` `93mgPQwURqpEvyzZcf9m`), confirmada por el cliente. En GHL tiene zona horaria `America/Bogota` (UTC−5, sin horario de verano, igual que Lima); el sistema usa la zona de cada subcuenta. Requiere un PIT de solo lectura propio de la subcuenta (§7).                                                                                                                                                                                                                                                                               |
| 2   | Servidor                   | Ubuntu 24.04.4 LTS, Docker 29.6, Docker Compose v5.1.4, 8 CPU, 23 GiB de RAM, 146 GB libres. Suficiente.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 3   | Driven Conteo y PostgreSQL | Conteo usa `drivenbox-db` (PostgreSQL 16, base `drivenbox_prod`, red `drivenbox_internal`), que es la base de **producción de DrivenBox** (esquemas `public`, `ghl`, `app`). **Decisión del cliente (cambia la §2 de la especificación): Driven Comercial usa un PostgreSQL propio** (contenedor `comercial-db`, `postgres:16.10-alpine`, volumen propio, sin puertos publicados, solo en la red `comercial`), para que una falla o una carga pesada de un sistema no afecte al otro. Se mantienen los esquemas `comercial` y `comercial_cola` y los 3 roles. |
| 4   | Dominio y proxy            | **`comercial.drivenbox.drivenautomations.com`**. El servidor usa **Traefik en Docker** (no Nginx ni Caddy) con entrada `websecure` y certificados `letsencrypt`, igual que `monitoreo.drivenbox...` de Conteo. La web se publica con etiquetas de Docker: no se edita ni se recarga la configuración de Traefik. Los puertos 80 y 443 son de Traefik; el 3100 del servidor está libre y se usa solo en `127.0.0.1` para diagnóstico.                                                                                                                          |
| 5   | Imágenes                   | **GHCR, publicadas por GitHub Actions** al hacer merge a `main`. Es más reproducible y no exige construir en la PC. `03-desplegar.ps1 -Origen Local` queda como respaldo. Si el repositorio es privado, el servidor necesita un token de GitHub de solo lectura de paquetes (`read:packages`), que se pide en `01-preparar-servidor.ps1`.                                                                                                                                                                                                                     |
| 6   | Clave de Anthropic         | Se necesita recién en la fase 4. Se cargará como secreto del entorno (nunca en el chat ni en el repositorio).                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 7   | Ramas                      | Esta sesión solo puede subir a `claude/bold-ptolemy-6m09ny`: un commit por fase en esa rama; el pull request se abre cuando se pida.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 8   | Token de agencia           | Solo lectura y solo para listar subcuentas.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Decisiones técnicas de la fase 1

Detalles que la especificación no fija. Todas se pueden cambiar.

| Tema                                     | Decisión                                                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sesiones                                 | Tabla `sesiones` (no figura en la §8). Se guarda el SHA-256 del token. Vencen a las 12 h sin uso, con un máximo de 7 días. Desactivar un usuario o restablecer su contraseña cierra sus sesiones. |
| Contraseñas                              | Argon2id (m = 19 MiB, t = 2). Mínimo 10 caracteres, con letras y números. La temporal se genera al azar y se muestra una sola vez.                                                                |
| Intentos fallidos                        | 5 por correo en 15 minutos; luego se bloquea 15 minutos. Se registra en `auditoria`.                                                                                                              |
| Revalidación para el análisis de calidad | Con 2FA activo se pide el código; sin 2FA, la contraseña.                                                                                                                                         |
| Subcuenta inexistente                    | Responde 403 igual que una ajena, para no revelar qué subcuentas existen.                                                                                                                         |
| Asesor                                   | Debe quedar vinculado a su `userId` de GHL al crearlo.                                                                                                                                            |
| Administrador                            | Conserva siempre los módulos de usuarios y configuración aunque se le pongan excepciones.                                                                                                         |
| `mensajes`                               | Clave primaria `(message_id, fecha)`: PostgreSQL exige que la columna de partición forme parte de la clave. Sin partición por defecto, para que un mes faltante falle de forma visible.           |
| Migraciones                              | Migrador propio sobre los archivos de drizzle-kit: el de Drizzle ejecuta `CREATE SCHEMA` y el rol migrador no tiene permiso para crear esquemas en la base compartida.                            |
| CSP                                      | Scripts solo con nonce por petición (`strict-dynamic`). Se permiten estilos en línea, porque el diseño aprobado usa estilos inline.                                                               |

## Decisiones técnicas de la fase 3

| Tema                  | Decisión                                                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Horario de Jade18K    | Provisional: lunes a viernes de 9:00 a 13:00 y de 14:00 a 18:00 para todas, con los feriados nacionales. Se reemplaza por el real desde la pantalla de horarios.                                                                                                                                                   |
| Intentos de contacto  | Bloques de salientes **humanos**. Un bloque nuevo empieza tras un mensaje del cliente o cuando pasan al menos 60 minutos laborales desde el saliente humano anterior (umbral `separacionIntentoMin`, editable por subcuenta). Los mensajes de la IA y los workflows no son intentos del asesor. **Por confirmar.** |
| Atención humana       | "Último saliente", "en espera" y "contactado hoy" consideran solo mensajes `manual`.                                                                                                                                                                                                                               |
| Seguimiento           | Vencido = Interesado o Por cerrar con más de 1 día laboral sin saliente humano o con una tarea vencida. Programado = tarea futura y sin vencimiento.                                                                                                                                                               |
| Fotos de días pasados | Usan la etapa y el estado actuales del lead (GHL no da la etapa histórica del lead fuera del historial de oportunidades).                                                                                                                                                                                          |
| Vista general         | Metas por defecto; la meta de ventas es la suma de las subcuentas (si todas la tienen).                                                                                                                                                                                                                            |

## Decisiones técnicas de la fase 4

| Tema                        | Decisión                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modelo y modo               | Claude Haiku 5.5 por la Batches API (50 % menos), sin pensamiento extendido y con esfuerzo bajo: es una clasificación con rúbrica simple. Salida JSON con esquema (`output_config.format`). El administrador global elige el modelo en Configuración › Calidad (`IA_MODELO` es el valor por omisión).                                                                                                                                                                                                                                                                                                                                              |
| Caché                       | Las instrucciones y la rúbrica (≈ 1.600 tokens en la v1 y ≈ 2.700 en la v2, más que el mínimo de 512 de Haiku 5.5) se marcan para caché en todas las solicitudes. En los lotes reales se leyó de caché casi toda la parte fija (instrucciones + esquema de structured outputs), incluso en el de la v2, que tardó 28 minutos.                                                                                                                                                                                                                                                                                                                      |
| Puntaje                     | Se deriva de los 5 criterios (un punto por criterio, mínimo 1): el modelo no lo envía, así siempre cumple la regla de la §6.2. Los mensajes "multimedia" no llevan puntaje.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Contexto                    | El tramo de la conversación dentro de las 3 etapas, máximo 40 mensajes y 6.000 caracteres. Los salientes de IA, workflows y campañas van como `[AUTOMATICO]` (contexto, nunca se califican). El contenido va delimitado y se instruye tratarlo solo como dato.                                                                                                                                                                                                                                                                                                                                                                                     |
| Asesor de cada conversación | El usuario que escribió más mensajes `manual` en ella dentro de las etapas de calidad (para la estratificación y el mejor/peor mensaje).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Reintentos                  | Una solicitud con error, vencida, rechazada, cortada o con JSON inválido se reenvía una vez en un lote nuevo; si vuelve a fallar queda `fallido` con su motivo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Tope                        | Antes de enviar se estima el costo y se compara con el tope el **costo máximo** (`costoMaximoUsd`): ninguna solicitud lee de caché y, con pensamiento, cada una usa todo su margen de 8.000 tokens. Así el tope no se pasa aunque la caché de la Batches API (de mejor esfuerzo) no funcione. El gasto del mes suma el costo real de los análisis terminados y el esperado de los abiertos.                                                                                                                                                                                                                                                        |
| Ejecución manual            | La web crea el análisis en estado `solicitado` y el worker lo toma en menos de 2 minutos (`calidad-solicitudes`). La revisión de lotes corre cada 30 minutos.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Precios                     | US$ 0,10 / 0,50 por millón (entrada / salida) en Haiku 5.5, lectura de caché 0,1×, lote 50 %. Están en `PRECIOS_POR_DEFECTO` (`packages/core/src/calidad.ts`); actualizar si cambian.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Estimación de costo         | Calibrada con los análisis reales (ver `docs/validacion.md`): 2,1 caracteres por token, parte fija por solicitud = instrucciones + esquema JSON + 40 tokens de envoltura (en caché salvo la primera), salida = 10 + 110 tokens por mensaje. Con pensamiento, el esperado no suma nada (sin datos; en la calibración con esfuerzo bajo costó lo mismo) y el máximo suma todo el margen. Constantes en `CALIBRACION_CALIDAD` (`packages/core/src/calidad.ts`). Al cerrar cada análisis el log `calidad_terminado` trae `desvioCostoPct`, y cada revisión de lotes registra `calidad_uso` con `cacheLeidaPct`: recalibrar si el desvío pasa de ±15 %. |

## Calidad: rúbrica v2 y calibración (16 nov 2026)

| Tema                         | Decisión                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rúbrica `v2-2026-11`         | Reglas explícitas donde la v1 dudó: "personalizado" exige el nombre del cliente o un dato que él dio (no cuentan el nombre del asesor, "caballero/señorita" ni "aquella joyita"); "seguimiento" solo tras un silencio del cliente; un enlace al catálogo es información de producto; confirmaciones breves y frases de transición son saludo o plantilla; pedir una aclaración necesaria cuenta como responder. Ejemplos anonimizados. |
| Misma frase, mismo resultado | Al cerrar cada análisis, tono, extensión y personalización se unifican entre mensajes con el mismo texto normalizado (mayoría; empate = falso). Un texto idéntico enviado a 2 o más conversaciones no es personalizado: no usa el nombre ni el contexto de ningún cliente (§6.2). "Responde" y "siguiente paso" dependen del contexto y no se tocan. Aprobado por el cliente el 16 nov 2026.                                           |
| Sin temperatura fija         | Haiku 5.5 rechaza `temperature` distinta de la predeterminada; la variación entre corridas se controla con la rúbrica, la unificación por texto y la calibración.                                                                                                                                                                                                                                                                      |
| Calibración                  | `calidad-calibrar` califica un conjunto revisado a mano (`docs/calibracion/`, solo ids y etiquetas) y mide la coincidencia. Una rúbrica, modelo o ajuste nuevo pasa a producción solo con **puntaje a ±1 ≥ 90 % y categoría ≥ 85 %**. No se exige puntaje exacto: una misma configuración coincide consigo misma en ~77 %.                                                                                                             |
| Esfuerzo y pensamiento       | Se mantienen esfuerzo bajo y sin pensamiento (`IA_ESFUERZO=low`, `IA_PENSAMIENTO=no`): activar el pensamiento no mejoró la coincidencia en la calibración y cuesta más.                                                                                                                                                                                                                                                                |

## Calidad: optimizaciones de calidad y costo (16 nov 2026)

| Tema                      | Decisión                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sin trabajo repetido (§6) | Cada conversación de la muestra guarda la huella SHA-256 de lo que se envía a la IA (versión de rúbrica, instrucciones, esquema, modelo, ajustes y texto). Si un análisis terminado de la subcuenta ya calificó una solicitud con la misma huella, se copian sus calificaciones (emparejando los mensajes por su número, aunque venga de otra conversación con el mismo texto) y no se envía. Si todo se reutiliza, el análisis se cierra sin lotes. Un mensaje nuevo fuera del contexto (por ejemplo, del cliente después del último mensaje calificado) no cambia la huella.            |
| Saludos sueltos por regla | Aprobado por el cliente el 16 nov 2026. Saludos, tratos genéricos, presentación del asesor y frases de transición sin contenido, con ortografía correcta, se califican sin IA: saludo o plantilla, no personalizado, sin siguiente paso, tono y extensión correctos; "responde" es falso si hay un pedido pendiente (se supone abierto si no se ve ningún mensaje del cliente). Cualquier otra palabra, el nombre del cliente o una falta lo dejan para la IA. Modelo guardado: `regla-saludos-v1`. Se desactiva con `CALIDAD_SALUDOS_POR_REGLA=no`; también se aplica en la calibración. |
| Formato de respuesta      | Se mantiene el v2 (`FORMATO_SALIDA_VIGENTE`). "Motivo primero" no mejoró la coincidencia y "compacto" ahorró ~17 % de salida a costa de ~4 puntos de puntaje a ±1. Quedan disponibles en `calidad-calibrar --formato` para futuras pruebas.                                                                                                                                                                                                                                                                                                                                               |
| Modelo                    | Se mantiene Haiku 5.5. Sonnet 5.5 mejora la categoría pero no los criterios y cuesta ~20 veces más; el límite está en ambigüedades de la rúbrica. El pensamiento se configura por modelo (Sonnet 5.5 se apaga con `between_tools`) y el costo real usa los precios del modelo (`preciosDe`).                                                                                                                                                                                                                                                                                              |
| Extensión por regla       | No se implementa: no hay rangos de largo definidos por el cliente y las diferencias observadas son de mensajes cortos que completan a otro, no de largo.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Conjuntos de calibración  | Dos: `jade18k-2026-11.json` (semana 9–15, ya no independiente para la v2) y `jade18k-2026-11-semana2.json` (semana 2–8, etiquetado sin ver a la IA). Una rúbrica v3 debe medirse con el segundo y con uno nuevo.                                                                                                                                                                                                                                                                                                                                                                          |
| Pendiente del cliente     | Tres ambigüedades de la rúbrica explican la mayoría de las diferencias con la revisión humana: si las tildes faltantes hacen falso el tono; si "responde" es verdadero cuando el pedido ya se atendió en un mensaje anterior o cuando se pide la talla para poder dar el precio; y si un mensaje corto que completa a otro tiene extensión adecuada.                                                                                                                                                                                                                                      |

## Alertas y retención (16 nov 2026)

| Tema                | Decisión                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alertas y resumen   | Sin correo. Las alertas en tiempo real y el resumen diario se envían por WhatsApp en la versión 2 (decisión del cliente). Mientras tanto, todo se consulta en las vistas.       |
| Retención del texto | `mensajes.texto` se borra a los 90 días (`purga-textos`, diario 03:30). Las clasificaciones y los indicadores se conservan; una recarga desde GHL no vuelve a guardar el texto. |

## Medición de respuestas (16 nov 2026, decisión del cliente)

| Tema                             | Decisión                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mensajes de entrada              | Los mensajes que empiezan con "Headline" o "\*Headline\*" son la entrada del lead al CRM: no cuentan como mensajes del cliente en ningún indicador. Tras 90 días su texto queda como la marca `*Headline*`, para seguir reconociéndolos.                                                                                                                                                                                                             |
| Etapa Nuevo                      | Mientras el lead está en Nuevo lo atiende el workflow: sus mensajes no se miden (ni tiempo de respuesta ni sin responder). La etapa sale del historial de etapas y del mapa actual; sin historial, cuenta la etapa actual.                                                                                                                                                                                                                           |
| Tiempo de respuesta              | Se mide cada mensaje del cliente que responde el asesor (`manual`), desde el primero sin responder (si escribe varios seguidos). El indicador es la mediana de todas esas respuestas, en minutos de reloj desde que el asesor está en turno (ver "Turno automático").                                                                                                                                                                                |
| Respuesta ganada por la IA       | Si el agente IA o un workflow responden antes que el asesor, la respuesta es suya ("ganada por el agente IA" o "del workflow") y no entra al tiempo del asesor. Las campañas no cuentan como respuesta.                                                                                                                                                                                                                                              |
| Sin responder                    | Falta del asesor: un mensaje del cliente que no respondió nadie (ni el asesor, ni el agente IA, ni un workflow), fuera de la etapa Nuevo, que lleva 15 min o más con el asesor en turno (y sigue siéndolo pasada la hora). Si el asesor lleva más de 3 h sin actividad, el pendiente se muestra aparte como "Asesor fuera de turno" y no es falta. En días pasados la foto se toma al cierre del turno de cada asesor (su última actividad del día). |
| Día de cada respuesta            | Cada respuesta cuenta en el día en que escribió el cliente.                                                                                                                                                                                                                                                                                                                                                                                          |
| Perdido por falta de seguimiento | Solo si el lead se perdió (o abandonó) con un mensaje del cliente que nadie respondió. Si el cliente dejó en visto una respuesta del asesor, de la IA o de un workflow, no es error del asesor aunque se marque perdido. Reemplaza la regla anterior de "menos de 2 intentos tras el silencio".                                                                                                                                                      |
| Turno automático (17 nov 2026)   | Sin depender de horarios cargados: el asesor está en turno mientras no pasen más de 3 h sin que escriba a ningún cliente. Si el cliente escribe con el asesor en turno, su tiempo corre desde el mensaje; si está fuera de turno (antes de empezar, en una pausa de más de 3 h o de noche), desde su primera actividad siguiente.                                                                                                                    |
| Efecto en Jade18K (10–16 nov)    | Mediana del asesor 12,5 min (promedio 78 min) sobre 509 respuestas; 1.073 respuestas del agente IA y 374 del workflow; el 16 nov, 33 faltas sin responder y 68 pendientes con la asesora fuera de turno; 2 de 178 perdidos por falta de seguimiento. Antes de estas reglas: 34,4 min y 1.377 sin responder.                                                                                                                                          |

## Imágenes, audios y videos (17 nov 2026, decisión del cliente)

- **Métricas:** una imagen, un audio o un video cuentan como mensaje igual que un texto. Si los envía
  el cliente, abren un pendiente; si los envía el asesor, son su respuesta. Así se medía ya, porque
  ni los tiempos ni "Sin responder" dependen del contenido. En la lista "Sin responder", un archivo
  sin texto se muestra como "(imagen)", "(audio)" o "(video)".
- **Respuesta con origen sin confirmar:** si GHL todavía no confirma quién escribió un saliente
  (`sin_origen`: lo escribió el asesor o el agente IA, pero no un workflow ni una campaña), igual
  cierra el pendiente, porque el cliente sí recibió una respuesta. No se mide como tiempo del asesor
  hasta que la reverificación confirme su origen. Antes, ese mensaje dejaba al cliente en "Sin
  responder" aunque ya le hubieran contestado.
- **Calidad: plus a favor.** Un mensaje calificado del asesor gana +1 punto, con tope de 5, si:
  - lleva una imagen, un audio o un video (por ejemplo, una foto con su precio al pie); o
  - el asesor envía uno de esos archivos en el mismo turno (sin que el cliente escriba en medio) y a
    no más de 30 minutos (`MINUTOS_PLUS_MULTIMEDIA`).
    Nunca resta. Los archivos de workflows o campañas no cuentan. Se guarda en
    `clasificaciones.plus_multimedia` y se aplica al cerrar el análisis, recalculando el puntaje desde
    los criterios (`aplicarPlusMultimedia`). En el motivo se muestra "+1 por enviar imagen, audio o
    video".
- **Contexto para la IA (rúbrica v3):** los archivos del cliente y del asesor aparecen como
  "(imagen)", "(audio)", "(video)" o "(adjunto)" (archivo con texto al pie, de tipo desconocido). Un
  archivo del cliente es un pedido: un saludo suelto después no lo responde. Un archivo del asesor
  sin texto no se califica. Los archivos de workflows sin texto no se envían, para no gastar contexto.
- Los documentos (PDF, Word…) no cuentan para el plus. Un documento con texto al pie se toma como
  "adjunto", porque solo se guarda la cantidad de adjuntos y no su tipo.

## Carga incremental: exportación atrasada de GHL (17 nov 2026)

- **Lo que pasó:** la foto que Nathalia envió a las 08:44 (hora de Lima) se veía como "Sin
  responder", aunque Ximena le respondió a las 15:40. La exportación de mensajes de GHL
  (`/conversations/messages/export`) iba unas 3 horas atrasada: a las 18:30 no entregaba casi nada
  posterior a las 15:30, aunque la consulta por conversación sí mostraba esos mensajes. La carga
  incremental pedía solo lo nuevo desde la pasada anterior, con 10 minutos de margen, así que un
  mensaje que aparecía tarde en la exportación quedaba fuera para siempre.
- **Corrección:**
  - en cada pasada incremental, los mensajes de cada conversación con actividad se traen
    directamente de la conversación (`cargarMensajesRecientes`), que GHL entrega al instante;
  - como respaldo, la exportación se vuelve a revisar en las últimas 24 horas
    (`HORAS_REVISION_EXPORTACION`).
    Todo se guarda con el mismo upsert idempotente, así que un mensaje que llega por las dos vías no
    se duplica.

## Rediseño visual del panel (18 nov 2026, aprobado por el cliente)

Reemplaza la referencia visual de `diseno/*.dc.html`, que queda como antecedente. Se aprobó sobre
una maqueta con datos reales de Jade18K.

- **Colores:** los de Driven de siempre (azul `#1F5BFF`, negro azulado `#0B0D12` y blanco) en pares
  claro/oscuro (`packages/ui/src/tokens.ts`, variables en `apps/web/src/app/globales.css`). Las
  pruebas de `tokens.test.ts` verifican el contraste: texto ≥ 4,5:1 y bordes de controles ≥ 3:1.
- **Modo oscuro automático:** sigue la preferencia del sistema (`color-scheme` en `<meta>` y `:root`).
  El menú lateral, el embudo, el resumen del asesor y los paneles de edición son siempre oscuros.
  Next compila `light-dark()` con variables que se resuelven una vez en `:root`, por eso esas zonas
  declaran directamente los valores oscuros.
- **Estados:** siempre ícono + texto, nunca solo color. En la columna A · S · N · C cada letra lleva
  ✓ (cumple) o ! (debajo de la meta).
- **Vista general:** el embudo comercial reemplaza las cuatro tarjetas oscuras. Cada etapa lleva una
  barra de avance hacia la meta (el `avance` de `destacado.ts`) y la etapa del cuello de botella va
  resaltada, con un aviso que lo explica en una frase.
- **Tablas:** con consultas de contenedor se convierten en tarjetas cuando falta ancho (celular).
- **Periodo:** control segmentado con radios nativos (Hoy · 7 días · Este mes · Rango).
- **"Para actuar ahora":** pestaña aparte para "Asesor fuera de turno".
- **Gráfico de tipos de mensaje:** serie categórica de 8 colores validada para daltonismo en ambos
  temas (variables `--serie-1…8`); la leyenda muestra nombre y porcentaje.
- **Tipografía:** Sora (títulos y cifras) e Inter (texto), servidas desde el propio dominio.

## Calidad: rúbrica v4 (18 nov 2026, decisiones del cliente)

- Tono: se tolera una sola tilde faltante; dos o más faltas, una palabra mal escrita o una frase
  confusa lo hacen falso.
- Responde: si el asesor ya respondió el pedido antes, un seguimiento o una pregunta nueva responde.
- Extensión: un mensaje corto que completa al anterior del mismo asesor se evalúa junto con él.
- Categoría: un saludo o presentación que solo hace preguntas generales es saludo_plantilla; con
  precio o enlaces del catálogo se clasifica por ese contenido.
- Responde (contradicción "sin precio es falso" / "aclaración necesaria"): si el cliente pidió
  precio y la asesora pregunta la talla, la fecha o el modelo, responde solo si explica por qué lo
  necesita ("de acuerdo a la talla es el peso y de acuerdo al peso es el precio").
- Resultados de calibración en `validacion.md`.

## Modelo de IA, módulo Asesores y velocidad (18 nov 2026, pedido del cliente)

- **Modelo de IA a elección del administrador global.** Configuración › Calidad tiene una tarjeta
  con Haiku 5.5 o Sonnet 5.5 (con su resultado de calibración y el costo que habría tenido el último
  análisis con cada uno) y el tope de gasto mensual. Solo el rol administrador la ve y la cambia;
  queda en auditoría (`ajustes_calidad_guardados`). Se guarda en `comercial.ajustes` (migración 0003) y tiene prioridad sobre `IA_MODELO` / `IA_TOPE_MENSUAL_USD`, que quedan como valores por
  omisión. El worker la lee en cada ciclo: no hace falta reiniciar. Un análisis manual fija su
  modelo al lanzarse (el mismo con el que se estimó el costo).
- **Corrección:** la estimación previa al envío usaba siempre el precio de Haiku. Ahora usa el del
  modelo elegido, así el tope también protege con Sonnet (unas 18 veces más caro).
- **Metas y etapas de calidad por subcuenta.** Ya se guardaban por subcuenta; la pantalla ahora lo
  dice en el título ("Metas y etapas · Jade18K") y en los mensajes al guardar, y el menú conserva la
  subcuenta que se está mirando al pasar a Asesores, Horarios o Metas.
- **Módulo Asesores propio** (`/asesores`): tabla de asesores de la subcuenta elegida, con periodo y
  enlace al detalle. Exige el permiso de detalle de asesores (no el de la vista de subcuenta); el
  asesor va directo a su propio detalle. Antes el menú solo abría la subcuenta.
- **Velocidad entre módulos:**
  - Esqueleto de carga inmediato al cambiar de módulo (`(panel)/loading.tsx`).
  - Las listas para actuar de la subcuenta (la consulta más pesada) llegan por streaming sin frenar
    los indicadores: la página empieza a mostrarse en ~0,02 s en vez de ~0,4 s (base local).
  - La consulta de "sin responder" lee los mensajes de la ventana una sola vez (~45 % menos).
  - Sesión, permisos y menú se calculan una vez por petición (antes, dos: layout y página).
- **403 con streaming:** como la página se envía detrás del esqueleto, el estado HTTP ya salió
  cuando la página revisa permisos. Por eso el layout revisa el acceso a la ruta pedida antes del
  primer byte en las cargas completas (`exigirAccesoRuta`, con la ruta que deja el proxy en
  `x-ruta`); en la navegación interna sigue revisando cada página. Entrar y salir de la sesión hace
  una carga completa de la página (además, no deja en el navegador nada de la sesión anterior).

## Pantallas grandes y metas de una subcuenta nueva (18 nov 2026, pedido del cliente)

- El contenido ocupa todo el ancho disponible (antes tenía un máximo de 1.440 px y en monitores
  grandes quedaba un espacio vacío a la derecha); el tope es 2.400 px. La columna del menú es oscura
  en todo el alto. Las tarjetas de indicadores se estiran para llenar la fila.
- Metas: los cuatro grupos van en 1 columna, 2 × 2 o 4 en fila según el ancho (nunca 3 + 1).
- Subcuenta nueva: empieza con las metas por defecto de Driven y sin etapas de calidad. La pantalla
  de Metas lo avisa, permite copiar las metas de otra subcuenta del usuario (se revisan y se guardan
  con «Guardar metas») y recuerda que sin sus 3 etapas de calidad no se analiza la calidad de sus
  mensajes.

## Selector de fechas, total y promedio por asesor y logo (19 nov 2026, pedido del cliente)

- **Selector de fechas:** un solo botón con el periodo («Últimos 7 días: 13 nov 2026 – 19 nov
  2026») que abre atajos (hoy, ayer, hoy y ayer, últimos 7/14/28/30 días, esta semana, la semana
  pasada, este mes, el mes pasado, personalizado) y un calendario de dos meses; se aplica con
  «Actualizar». La semana empieza el lunes y no se eligen días futuros. Las URL anteriores
  (`?periodo=hoy|mes|rango`) siguen funcionando.
- **Tabla de asesores:** al pie, «Total del equipo» (leads, sin responder, pendientes y ventas
  sumados; tiempo de respuesta = mediana real de toda la subcuenta; calidad del equipo; conversión =
  ventas ÷ leads) y «Promedio por asesor» (cada columna dividida entre los asesores de la tabla;
  en tiempo, calidad y conversión, solo los que tienen dato). Decisión del cliente: las dos filas.
- **Logo:** la «D» de Driven como ícono de la pestaña (`icon.png`, `apple-icon.png`, `favicon.ico`
  en `apps/web/src/app`).
