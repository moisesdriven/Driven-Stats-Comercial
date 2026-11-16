# Prompt para Claude Code

## Cómo usarlo

**Opción A · Claude Code en la nube (claude.ai/code, con tu repositorio de GitHub)**

1. Crea un repositorio privado vacío en GitHub (por ejemplo `driven-comercial`).
2. Sube a ese repositorio `ESPECIFICACION.md`, `PROMPT.md` y la carpeta `diseno/` (en GitHub: Add file › Upload files).
3. En claude.ai/code elige ese repositorio y configura el entorno de la nube:
   - **Acceso a red:** permite `services.leadconnectorhq.com` (API de GHL), `api.anthropic.com` (análisis de calidad) y los registros de paquetes (npm).
   - **Variables de entorno:** `GHL_PIT_PILOTO` (PIT de solo lectura de la subcuenta piloto), `GHL_LOCATION_ID_PILOTO` y `ANTHROPIC_API_KEY`. Nunca las subas al repositorio.
4. Elige el modelo (ver abajo) y pega el bloque de código completo.

**Opción B · Claude Code en tu PC:** abre Claude Code en una carpeta vacía con `ESPECIFICACION.md` y `diseno/`, y pega el bloque. Los tokens van en `.env` local.

**Modelo recomendado:** Opus para las fases 0 a 4 y 7 (arquitectura, permisos, horario laboral, indicadores, análisis de calidad, despliegue). Sonnet sirve para la fase 5 (pantallas a partir del diseño) y ajustes menores, con menos consumo. Usa el modo plan al inicio de cada fase.

---

```
Vas a construir "Driven Comercial", un sistema interno de la agencia Driven para medir la eficiencia de los equipos comerciales de sus subcuentas de GoHighLevel (GHL): desde que entra un lead hasta que se concreta o se pierde la venta. Trabajarás por fases y esperarás mi aprobación al final de cada una.

1. FUENTE DE VERDAD
- Lee completo ESPECIFICACION.md antes de escribir código. Todo lo que construyas debe cumplirlo. Si algo es ambiguo o contradictorio, pregúntame; no inventes reglas de negocio.
- La carpeta diseno/ tiene la interfaz aprobada en 5 pantallas (.dc.html): vista general, vista por subcuenta, detalle del asesor, horarios, y usuarios y accesos. No se ejecutan (dependen de un runtime que no viene incluido): léelas como referencia de estructura, jerarquía, colores, tipografía y estilos, y replícalas fielmente en componentes React. Los números y nombres de asesores son de ejemplo.

2. RESUMEN DE DECISIONES (detalle en la especificación)
- Proyecto independiente de "Driven Conteo" (otro equipo): repositorio propio, mismo servidor PostgreSQL pero solo los esquemas propios "comercial" y "comercial_cola", roles de base de datos propios, credenciales propias. Nunca leas ni modifiques los esquemas "ghl" ni "app" ni nada de Driven Conteo.
- Multi-subcuenta desde el inicio, pero el piloto se hace con UNA sola subcuenta. Agregar más subcuentas debe hacerse desde la interfaz, sin tocar código.
- 8 indicadores agrupados en 4 etapas (atención, seguimiento, negociación, cierre) con semáforo frente a metas por subcuenta, cuello de botella y alertas cruzadas (sección 5).
- Todos los tiempos se miden en horario laboral de cada asesor en cada subcuenta, con tramos partidos, ausencias y feriados (sección 4).
- Accesos (sección 10.1): rol (Administrador, Dueño de negocio, Supervisor, Asesor) + subcuentas asignadas (una o varias; el dueño de negocio ve una vista general que suma solo sus subcuentas) + módulos con ver/editar y excepciones por usuario. El filtro por subcuenta se aplica en el servidor en cada consulta.
- Calidad de mensajes (sección 6), por muestra y con bajo gasto de API:
  * Muestra aleatoria de 1,000 conversaciones por subcuenta, estratificada por asesor y reproducible (semilla guardada).
  * Solo mensajes escritos por asesores (nunca agente de IA, workflows ni campañas) y enviados mientras el lead estaba en las 3 etapas de calidad que cada subcuenta elige de su propio pipeline (sin valores por defecto).
  * Se ejecuta automáticamente el día 1 de cada mes (mes anterior) o con el botón "Ejecutar análisis de calidad", solo para administradores: muestra antes el costo estimado y exige reingresar la contraseña o el código 2FA; máximo de ejecuciones manuales por mes y tope de gasto mensual.
  * Una solicitud por conversación (no por mensaje), Message Batches API, caché de instrucciones si aplica, Claude Haiku 5.5 por defecto, salida JSON compacta validada con Zod, costo real guardado por análisis.
- Solo lectura sobre GHL: el sistema nunca escribe ni envía nada en GHL.

3. ANTES DE EMPEZAR, PREGÚNTAME EN UN SOLO MENSAJE
1. Cuál es la subcuenta piloto.
2. Sistema operativo y versión del servidor, y si tiene Docker y Docker Compose.
3. Cómo corre hoy Driven Conteo en ese servidor (contenedores, puertos ocupados, proxy inverso: Nginx, Caddy o Traefik) y cómo se conecta a PostgreSQL (contenedor o instalado en el host, versión).
4. Dominio o subdominio para este sistema.
5. Si quiero imágenes en GHCR (publicadas por GitHub Actions) o build local en mi PC.
No me pidas contraseñas ni tokens por el chat: van en variables de entorno (de la nube o de .env local) o se piden en los scripts con Read-Host -AsSecureString.

4. REGLAS TÉCNICAS
- Stack obligatorio: monorepo Node 22 + pnpm 10, Next.js (UI + API), worker con pg-boss (esquema comercial_cola), Drizzle ORM (solo esquema comercial), TypeScript estricto, Zod, Vitest, Playwright, Docker, GitHub Actions. Estructura de carpetas según la sección 2.
- Reglas de negocio puras en packages/core, con pruebas unitarias de todos los casos borde (horario laboral, indicadores, semáforo, cuello de botella, alertas cruzadas, muestreo estratificado).
- Pruebas de integración que demuestren que un dueño de negocio no puede ver subcuentas que no tiene asignadas, aunque cambie la URL o llame a la API directamente, y que solo un administrador puede lanzar el análisis de calidad.
- Nunca uses tokens reales en pruebas: GHL simulado y API de Anthropic simulada.
- Verifica en la documentación oficial de GHL el header Version, los parámetros y la paginación de cada endpoint antes de usarlo, y en la de Anthropic los límites vigentes de la Message Batches API y del prompt caching. No los supongas.
- Ningún secreto en el repositorio. Crea .env.example con todas las variables comentadas.
- Interfaz, mensajes, documentación y comentarios en español neutro.
- Crea CLAUDE.md con las convenciones del proyecto y mantenlo actualizado.

5. FORMA DE TRABAJAR
- Sigue las fases de la sección 14, en orden. Empieza cada fase con un plan corto.
- Al terminar cada fase: corre lint, typecheck, tests y build; haz commit (si trabajas en la nube, una rama por fase y un pull request); dame un resumen corto de lo hecho, cómo probarlo y qué necesitas de mí. Espera mi confirmación antes de seguir.
- Fase 2, antes de calcular indicadores, con datos reales de la subcuenta piloto:
  * Documenta en docs/mapeo-origen.md cómo distinguir mensajes manuales, de workflow, del agente de IA y de campañas. Muéstramelo para aprobarlo.
  * Verifica si los registros de actividad de oportunidad de las conversaciones incluyen los cambios de etapa (origen, destino y fecha); de eso depende reconstruir el historial de etapas de la carga histórica. Dímelo antes de la fase 4.
  * Si la red no permite llegar a la API de GHL, avísame en vez de suponer el formato.
- Fase 4: antes de lanzar el primer análisis real de calidad, muéstrame el costo estimado y espera mi aprobación. Al terminar, compara el costo real con el estimado.

6. DESPLIEGUE (fase 7, obligatorio)
- El despliegue lo ejecuto yo desde mi PC con Windows, solo con scripts de PowerShell (ssh y scp de OpenSSH de Windows), hacia el servidor donde ya corre Driven Conteo. Tú no te conectas al servidor: escribes y pruebas los scripts.
- Entrega los scripts de scripts/deploy/ descritos en la sección 13 (00 a 08 + config.example.psd1), compatibles con Windows PowerShell 5.1 y PowerShell 7, validados con PSScriptAnalyzer si está disponible.
- Entrega docs/DEPLOY.md: guía paso a paso para alguien sin experiencia, con cada comando listo para copiar y pegar en PowerShell, qué debe verse en pantalla en cada paso y qué hacer si falla. Debe cubrir: clonar el repositorio en mi PC, primera instalación, crear el primer administrador, dar de alta la subcuenta piloto, carga histórica, configurar las 3 etapas de calidad, lanzar el primer análisis de calidad, agregar otra subcuenta, actualizar a una nueva versión, revertir y sacar respaldo.
- Ningún script debe tocar Driven Conteo. Antes de cualquier acción que modifique el servidor (crear esquema y roles, recargar el proxy), el script muestra lo que va a hacer y pide confirmación.
- Al final, dame en el chat el resumen del paso a paso para desplegar, con los comandos exactos en orden.

Empieza leyendo ESPECIFICACION.md y los archivos de diseno/, y luego hazme las preguntas iniciales.
```
