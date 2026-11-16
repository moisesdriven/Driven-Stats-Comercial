# Validación con datos reales

## Fase 2 · carga de Jade18K en modo sombra (16 de noviembre de 2026)

Entorno de desarrollo, base PostgreSQL 16 local con los roles reales (`comercial_web`,
`comercial_worker`, `comercial_migrador`) creados por `scripts/sql/esquema_y_roles.sql`. Flujo
completo de la aplicación: alta de la subcuenta por la API (verificación real de los 7 permisos del
PIT), mapa de etapas y etapas de calidad por la API (decisiones del cliente), carga incremental y
carga histórica de 7 días con `node dist/cli.js historico --dias 7 --directo`.

### Resultado de la carga

| Concepto                                 | Valor                                                              |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Llamadas a GHL                           | 9.666 en unos 23 minutos (límite de 80 cada 10 s, sin errores 429) |
| Mensajes guardados                       | 27.525                                                             |
| Consultas a Conversation AI              | 6.606 (todas respondieron: 0 mensajes `sin_origen`)                |
| Conversaciones con actividad en el rango | 2.830                                                              |
| Actividades de oportunidad               | 4.696, de 3.020 oportunidades, todas traducidas a etapas           |
| Oportunidades                            | 13.091                                                             |
| Ventas vigentes (Adelanto o posterior)   | 29 (octubre: 20, noviembre: 9), más 1 venta cancelada              |
| Tareas                                   | 609                                                                |
| Contactos con primer mensaje entrante    | 2.768 (2.580 leads nuevos y 188 clientes que ya conversaban antes) |

### Controles

- **Completitud:** los mensajes guardados coinciden con el `total` que informa GHL para el mismo
  rango (por ejemplo, 11–12 nov: 4.487 en GHL y 4.487 en la base; 13–14 nov: 4.274 y 4.274).
- **Idempotencia:** repetir la carga no duplica mensajes, eventos ni historial (también cubierto por
  prueba automática).
- **Origen de los salientes:** workflow 63,8 % · agente de IA 18,4 % · manual 17,9 %.
- **Asignación:** los leads se reparten de forma pareja entre las 4 asesoras (unos 645 cada una).

### Primera mirada (tiempos de reloj, aún sin horario laboral)

Solo indicativo: los tiempos oficiales se calculan en la fase 3 con el horario laboral de cada
asesora.

| Asesora   | Leads | Sin respuesta humana | Mediana hasta la primera respuesta humana (min, reloj) |
| --------- | ----- | -------------------- | ------------------------------------------------------ |
| Asesora A | 647   | 421                  | 170                                                    |
| Asesora B | 646   | 515                  | 57                                                     |
| Asesora C | 644   | 343                  | 521                                                    |
| Asesora D | 643   | 123                  | 246                                                    |

En casi todos los leads el primer saliente es automático (workflow o agente de IA); sin separarlo,
los tiempos de respuesta parecerían de segundos.

## Fase 3 · indicadores con datos reales (16 de noviembre de 2026)

Configuración provisional de Jade18K (cargada por la API): horario general de lunes a viernes de
9:00 a 13:00 y de 14:00 a 18:00 para todas las asesoras, y feriados nacionales del rango (30 ago,
8 oct, 1 nov, 8, 9 y 25 dic).

### Validación de 20 leads contra GHL

Muestra aleatoria de 20 leads que ingresaron entre el 10 y el 15 de noviembre. Se compararon contra
GHL por un camino **independiente** de la carga: mensajes de cada conversación
(`GET /conversations/{id}/messages`, no la exportación), Conversation AI mensaje por mensaje y la
oportunidad más reciente del contacto.

| Campo                                 | Coincidencias |
| ------------------------------------- | ------------- |
| Ingreso (primer mensaje entrante)     | 20 / 20       |
| Primera respuesta humana (fecha)      | 20 / 20       |
| Quién dio la primera respuesta humana | 20 / 20       |
| Estado (abierto, ganado o perdido)    | 20 / 20       |
| Etapa estándar                        | 20 / 20       |
| Asesora asignada                      | 20 / 20       |

Revisión manual de minutos laborales:

| Caso                                                             | Minutos laborales                   | Correcto |
| ---------------------------------------------------------------- | ----------------------------------- | -------- |
| Entra miércoles 19:05 (fuera de horario), respuesta jueves 18:40 | 480 (jornada completa del jueves)   | Sí       |
| Entra viernes 21:51, respuesta sábado 10:11                      | 0 (sin tiempo laboral entre ambos)  | Sí       |
| Entra 8:52, respuesta 9:02                                       | 2,5 (desde el inicio de la jornada) | Sí       |
| Entra miércoles 19:36, respuesta jueves 11:14                    | 134                                 | Sí       |

### Indicadores de la semana del 9 al 15 de noviembre

| Indicador                                                      | Jade18K                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| Leads recibidos                                                | 2.578                                                               |
| Tiempo de respuesta humana (mediana / promedio, min laborales) | 38 / 106                                                            |
| Leads sin respuesta humana (al cierre del periodo)             | 1.402                                                               |
| Intentos por lead (distribución 0 / 1 / 2 / 3+)                | 0,64 (1.384 / 959 / 132 / 103)                                      |
| Respuesta efectiva                                             | 3,6 %                                                               |
| Abandono                                                       | 44,1 %                                                              |
| Conversión                                                     | 0,16 % (4 ventas)                                                   |
| Tiempo de cierre                                               | 1,8 días laborales                                                  |
| Leads perdidos                                                 | 192 (190 sin motivo registrado en GHL), 43 por falta de seguimiento |
| Cuello de botella                                              | Atención; alerta: "Está perdiendo ventas por no hacer seguimiento"  |

Por asesora, la mediana de respuesta va de 12 a 184 minutos laborales y los leads sin respuesta
humana van de 122 a 510.

Observaciones para el cliente:

- En GHL, 647 de 681 oportunidades perdidas no tienen motivo (`lostReasonId` vacío).
- Con el mapa aprobado solo "Cotizado" cuenta para seguimiento; de los leads de estos días solo 2
  llegaron a Cotizado, por eso "seguimiento vencido" y "cumplimiento" casi no tienen datos.
- Una asesora respondió decenas de mensajes a medianoche con respuestas rápidas; se clasificaron bien
  como humanos (ninguno llegó en menos de 60 s). Fuera de horario cuentan 0 minutos laborales.

### Pendiente

- Carga histórica completa de 90 días en el servidor (≈ 125.000 llamadas; se reparte respetando el
  límite diario de GHL).
- Horario real de cada asesora (el actual es provisional).

## Fase 4 · primer análisis de calidad real (16 de noviembre de 2026)

Jade18K, semana del 9 al 15 de noviembre, lanzado como análisis manual por la API
(`POST /api/calidad/analisis`) y procesado con `calidad-revisar` (Batches API, `claude-haiku-5-5`,
rúbrica `v1-2026-11`). Base local recreada con `docs/desarrollo-piloto.md`.

### Costo y volumen

| Concepto                    | Estimado | Real      | Diferencia |
| --------------------------- | -------- | --------- | ---------- |
| Solicitudes (una por conv.) | 452      | 452       | —          |
| Mensajes calificados        | 1.212    | 1.212     | 0 fallidos |
| Tokens de entrada           | 732.073  | 1.183.607 | +62 %      |
| Tokens de salida            | 77.960   | 137.772   | +77 %      |
| Costo (US$)                 | 0,0303   | 0,0523    | +73 %      |

- El costo real quedó dentro de los US$ 0,06 aprobados, pero **la estimación se queda corta en
  ~70 %**: hay que corregirla antes de que se use como control del tope mensual.
- El lote tardó unos 6 minutos (enviado 08:53, terminado 09:00 UTC).
- Universo: 454 conversaciones elegibles (todas entraron a la muestra); descartes: 284 fuera de las
  etapas de calidad, 31 triviales, 63 por el tope de mensajes por conversación y 2 sin mensajes
  calificables.

### Resultado

| Categoría                | Mensajes | Puntaje medio |
| ------------------------ | -------- | ------------- |
| Saludo o plantilla       | 350      | 2,1           |
| Información/precio       | 324      | 3,0           |
| Pregunta de calificación | 260      | 3,2           |
| Seguimiento              | 85       | 2,7           |
| Llamada a la acción      | 78       | 3,3           |
| Respuesta a pregunta     | 66       | 2,7           |
| Multimedia (sin puntaje) | 36       | —             |
| Manejo de objeción       | 13       | 3,4           |

De los 1.176 mensajes con puntaje, 310 obtuvieron 4–5 y 573 obtuvieron 1–2. Criterios cumplidos:
extensión 74 %, tono 70 %, siguiente paso 52 %, responde 44 %, personalizado 34 %. El puntaje medio
por asesora va de 2,7 a 2,9.

### Revisión manual de 100 mensajes

Muestra aleatoria y reproducible (orden por `md5(message_id || 'semilla42')`) de los 1.212 mensajes
calificados, revisada con el contexto previo de cada conversación.

| Resultado                                                    | Mensajes |
| ------------------------------------------------------------ | -------- |
| De acuerdo con la categoría y los cinco criterios            | 83       |
| Categoría discutible (puntaje correcto)                      | 9        |
| Un criterio discutible (puntaje a ±1)                        | 7        |
| Error de puntaje de 2 o más puntos                           | 1        |
| **Puntaje dentro de ±1 del que asignaría un revisor humano** | **99**   |

Patrones observados:

- **"personalizado" inconsistente en textos idénticos.** La misma frase de presentación recibió
  "personalizado" verdadero en un caso y falso en otros; lo mismo ocurrió con la plantilla de
  seguimiento ("retomar aquella joyita…": puntaje 4 en un caso y 2 en otro, el único error de 2
  puntos) y con "Me envía captura de su modelo…". Conviene reforzar en la rúbrica que el nombre del
  asesor o un trato genérico ("caballero", "señorita") no cuentan como personalización.
- **"seguimiento" se usa para respuestas** que no retoman una conversación en silencio (por
  ejemplo, "Perfecto señorita, estoy atenta" tras un mensaje del cliente).
- Mensajes que solo envían un enlace de catálogo quedaron como "llamada a la acción" o "multimedia"
  según el caso; lo esperable es "información de producto".
- Los saludos sueltos ("Hola, buenos días ☺️") y los "ahora le brindo información" sin contenido se
  califican de forma consistente como plantilla con puntaje 1–2, que es lo correcto.

Observaciones para el cliente (sin datos personales):

- Las asesoras dividen el saludo en varios mensajes cortos (saludo, presentación, "ahora le brindo
  información"); cada uno se califica por separado y baja el promedio.
- En al menos tres conversaciones de la muestra una asesora pide continuar por su número personal
  porque "el programa se bloquea después de unas horas". Esas conversaciones dejan de quedar
  registradas en GHL.
- Varias cotizaciones se reenvían con pesos distintos sin explicar el cambio.

### Pendiente

- Corregir la estimación de tokens (subestima ~70 %).
- ~~Ajustar la rúbrica según los patrones anteriores y versionarla (`v2`).~~ Hecho: ver la sección
  siguiente.

## Calidad · rúbrica v2 y calibración (16 de noviembre de 2026)

### Conjunto de calibración

`docs/calibracion/jade18k-2026-11.json`: los mismos 100 mensajes de la revisión manual, con sus
etiquetas de referencia (solo ids; el contexto se reconstruye desde la base). Se revisó en dos
pasadas: la primera partió de las etiquetas de la v1 y corrigió los errores evidentes; la segunda
contrastó con las reglas escritas de la v2 cada discrepancia que la IA repitió en dos corridas
(63 etiquetas cambiadas, la mayoría de tono por faltas de ortografía, personalización de
cotizaciones estándar y extensión de mensajes que solo traen un enlace). Donde la regla no
respaldaba a la IA, se mantuvo la referencia.

Advertencia: la segunda pasada miró las respuestas de la v2, así que este conjunto ya no es
independiente para la v2. Para la siguiente versión de la rúbrica conviene revisar un conjunto nuevo
de otra semana o de otra subcuenta.

### Resultados (contexto reconstruido, Batches API, Haiku 5.5)

| Configuración                       | Categoría | Puntaje exacto | Puntaje ±1 | 5 criterios iguales | Costo (US$) |
| ----------------------------------- | --------- | -------------- | ---------- | ------------------- | ----------- |
| v1, sin pensamiento, low            | 83 %      | 53 %           | 88 %       | 36 %                | 0,008       |
| v2, sin pensamiento, low (A)        | 86 %      | 67 %           | 93 %       | 62 %                | 0,009       |
| v2, sin pensamiento, low (B)        | 87 %      | 67 %           | 92 %       | 61 %                | 0,009       |
| v2, sin pensamiento, low (C, final) | 85 %      | 61 %           | 91 %       | —                   | 0,009       |
| v2, con pensamiento, low            | 88 %      | 57 %           | 91 %       | 49 %                | 0,009       |
| v2, con pensamiento, medium         | 83 %      | 51 %           | 92 %       | 46 %                | 0,016       |

- La corrida final (C) aprueba, pero con la categoría justo en el mínimo: la v2 cumple el umbral
  sin margen; conviene vigilarla con un segundo conjunto.
- **Repetibilidad:** dos corridas idénticas de la v2 coinciden entre sí en 92 % de las categorías,
  77 % del puntaje exacto y 98 % del puntaje a ±1 (por criterio: responde 97 %, personalizado 95 %,
  siguiente paso 97 %, tono 89 %, extensión 86 %). Haiku 5.5 no admite temperatura fija, así que
  ese es el techo del puntaje exacto; por eso la aprobación exige ±1 y categoría.
- La mayoría de 3 corridas no mejoró la coincidencia: no compensa triplicar el costo.
- El pensamiento adaptativo tampoco mejoró (el tono empeora) y cuesta hasta el doble.
- Por criterio, la v2 coincide con la referencia en: siguiente paso 96 %, personalizado 91 %,
  extensión 88 %, responde 88 % y tono 86 %. Tono y extensión siguen siendo los más subjetivos.

### Unificación por texto sobre el análisis real de la semana

En el análisis del 9 al 15 de noviembre (rúbrica v1), 555 de los 1.176 mensajes con puntaje (47 %)
pertenecen a 82 textos que se repiten. Con la unificación, 159 de ellos cambian algún criterio (138
pierden "personalizado" porque el mismo texto fue a varios clientes) y el puntaje medio de esos
mensajes pasa de 2,63 a 2,36. Desde la v2 se aplica sola al cerrar cada análisis.

## Calidad · análisis completo con la rúbrica v2 (16 de noviembre de 2026)

Jade18K, semana del 9 al 15 de noviembre (análisis 2). Como el universo (454 conversaciones) es
menor que la muestra, se calificaron exactamente los mismos 1.212 mensajes que con la v1, así que la
comparación es directa.

| Concepto                        | v1 (análisis 1) | v2 (análisis 2)  |
| ------------------------------- | --------------- | ---------------- |
| Mensajes calificados / fallidos | 1.212 / 0       | 1.212 / 0        |
| Costo estimado → real (US$)     | 0,0303 → 0,0523 | 0,0318 → 0,0556  |
| Duración del lote               | 6 min           | 28 min           |
| Puntaje medio                   | 2,76            | 2,56             |
| Mensajes con 4–5 / con 1–2      | 310 / 573       | 240 / 610        |
| Unificados por texto al cerrar  | —               | 138 en 84 textos |

Criterios cumplidos: personalizado 34 % → 10 %, tono 70 % → 59 %, responde 44 % → 56 %,
siguiente paso 52 % → 49 %, extensión 74 % → 77 %. La caída de "personalizado" es la esperada: la v2
no acepta plantillas ni el nombre de la asesora, y la unificación lo deja en falso cuando el mismo
texto fue a varios clientes.

Categorías: "seguimiento" baja de 85 a 41 (ya no se usa para respuestas) y "multimedia" de 36 a 4
(los enlaces pasan a información de producto, que sube de 324 a 390).

Entre v1 y v2 coinciden 77 % de las categorías, 45 % del puntaje exacto y 85 % del puntaje a ±1.

Por asesora (puntaje medio v1 → v2): A 2,86 → 2,70 · B 2,67 → 2,59 · C 2,79 → 2,52 ·
D 2,72 → 2,35. **El orden cambia:** con la v1 la de menor puntaje era B; con la v2 es D, que pierde
más por mensajes de plantilla repetidos y faltas de ortografía. C tiene el tono más bajo (20 % de
sus mensajes) y A el más alto (86 %).

El estimador vuelve a quedarse corto (+75 %); sigue pendiente corregirlo.
