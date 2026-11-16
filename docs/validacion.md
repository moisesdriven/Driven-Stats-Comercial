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

### Pendiente para la fase 3

- Validación manual de 20 leads contra GHL (ingreso, primera respuesta, intentos y estado).
- Carga histórica completa de 90 días en el servidor (≈ 125.000 llamadas; se reparte respetando el
  límite diario de GHL).
