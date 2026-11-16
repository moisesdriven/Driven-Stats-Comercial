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
