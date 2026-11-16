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

- ~~Corregir la estimación de tokens (subestima ~70 %).~~ Hecho: ver "Corrección de la estimación".
- Ajustar la rúbrica según los patrones anteriores y versionarla (`v2`).

### Corrección de la estimación

Causas del desvío (deducidas de los totales y del costo real, que separa lo leído de caché de lo
demás):

| Supuesto original                                  | Observado                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| 3,5 caracteres por token                           | ~2,1 en el texto enviado (chat en español con emojis, precios y marcas) |
| Parte fija = instrucciones + 300 (esquema) ≈ 1.273 | ~2.040 tokens por solicitud leídos de caché (instrucciones + esquema)   |
| Salida = 25 + 55 por mensaje                       | ~114 por mensaje calificado (el `motivo` y los criterios ocupan más)    |

Nueva fórmula (`estimarCosto`, constantes en `CALIBRACION_CALIDAD`): parte fija = tokens de
`INSTRUCCIONES_CALIDAD` + tokens del esquema JSON + 40 de envoltura, a 2,1 caracteres por token,
escrita en caché en la primera solicitud y leída en las demás; conversación a 2,1 caracteres por
token; salida = 10 + 110 por mensaje. Con el caso del piloto:

| Concepto          | Estimado anterior | Estimado nuevo | Real      | Desvío nuevo |
| ----------------- | ----------------- | -------------- | --------- | ------------ |
| Tokens de entrada | 732.073           | ~1.182.000     | 1.183.607 | −0,1 %       |
| Tokens de salida  | 77.960            | 137.840        | 137.772   | +0,05 %      |
| Costo (US$)       | 0,0303            | 0,0522         | 0,0523    | −0,2 %       |

La calibración sale de un solo análisis, así que el ajuste exacto a este caso es esperable; la
prueba exige ±15 %. Si el lote no aprovecha la caché (es de mejor esfuerzo en la Batches API), el
costo real puede superar al estimado: en el peor caso, sin ninguna lectura de caché, este análisis
habría costado unos US$ 0,09. Conviene recalibrar con los próximos análisis.
