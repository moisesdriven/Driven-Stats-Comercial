# Prompt para Claude Code

## Cómo usarlo

**Opción A · Claude Code en la nube (claude.ai/code, con tu repositorio de GitHub)**

1. Crea un repositorio privado vacío en GitHub (por ejemplo `driven-comercial`).
2. Sube a ese repositorio `ESPECIFICACION.md`, `PROMPT.md` y la carpeta `diseno/` (desde la web de GitHub: Add file › Upload files).
3. En claude.ai/code elige ese repositorio y configura el entorno de la nube:
   - **Acceso a red:** permite `services.leadconnectorhq.com` (API de GHL), `api.anthropic.com` (clasificador) y los registros de paquetes (npm).
   - **Variables de entorno:** el PIT de solo lectura de una subcuenta de prueba y su `locationId`, y la clave de Anthropic. Nunca las subas al repositorio.
4. Elige el modelo (ver recomendación abajo) y pega el bloque de código de abajo.

**Opción B · Claude Code en tu PC**

Abre Claude Code en una carpeta vacía donde copiaste `ESPECIFICACION.md` y `diseno/`, y pega el bloque. Los tokens van en `.env` local.

**Modelo recomendado:** Opus para las fases de diseño y lógica (0 a 3 y 7: arquitectura, permisos, horario laboral, indicadores, despliegue). Para fases más mecánicas (pantallas a partir del diseño, ajustes) puedes cambiar a Sonnet y ahorrar consumo. Usa el modo plan al inicio de cada fase.

---

```
Vas a construir "Driven Comercial", un sistema interno para medir la eficiencia de los equipos comerciales de todas las subcuentas de GoHighLevel de la agencia Driven.

FUENTE DE VERDAD
- Lee completo ESPECIFICACION.md antes de escribir código. Todo lo que construyas debe cumplirlo.
- La carpeta diseno/ tiene la interfaz aprobada (5 pantallas en archivos .dc.html: vista general, subcuenta, asesor, horarios, usuarios y accesos). No se ejecutan: léelos como referencia de estructura, jerarquía, colores y estilos, y replícalos fielmente en componentes React. Los números que aparecen ahí son de ejemplo; en el sistema real salen de la base.
- Si algo de la especificación es ambiguo o contradictorio, pregúntame antes de decidir. No inventes reglas de negocio.

ANTES DE EMPEZAR, PREGÚNTAME (en un solo mensaje):
1. Sistema operativo y versión del servidor, y si ya tiene Docker y Docker Compose.
2. Cómo corre hoy Driven Conteo en ese servidor (contenedores, puertos ocupados, proxy inverso: Nginx, Caddy o Traefik) y cómo se conecta a PostgreSQL (contenedor o instalado en el host, versión).
3. Dominio o subdominio para este sistema.
4. Si quiero imágenes en GHCR (publicadas por GitHub Actions) o build local en mi PC.
5. Si ya tengo clave de API de Anthropic para el clasificador de calidad.
No me pidas contraseñas ni tokens por el chat: van en variables de entorno (de la nube o de .env local) o se piden en los scripts con Read-Host -AsSecureString.

REGLAS DE TRABAJO
- Proyecto independiente de Driven Conteo: repositorio propio, esquema PostgreSQL propio ("comercial" y "comercial_cola"), roles propios, credenciales propias. Nunca leas ni modifiques los esquemas "ghl" ni "app", ni contenedores, redes o configuración de Driven Conteo.
- Stack obligatorio: monorepo Node 22 + pnpm 10, Next.js (UI + API), worker con pg-boss, Drizzle ORM, TypeScript estricto, Zod, Vitest, Playwright, Docker, GitHub Actions.
- Reglas de negocio puras en packages/core, con pruebas unitarias que cubran los casos borde de la especificación (sobre todo el horario laboral por asesor).
- Permisos (sección 10.1): rol + subcuentas asignadas + módulos con ver/editar y excepciones por usuario. El filtro por subcuenta se aplica en el servidor en cada consulta; agrega pruebas de integración que demuestren que un dueño de negocio no puede ver subcuentas que no tiene asignadas, aunque cambie la URL o llame a la API directamente.
- Solo lectura sobre GHL. Nunca uses tokens reales en pruebas: usa un GHL simulado.
- Ningún secreto en el repositorio. Crea .env.example con todas las variables comentadas.
- Interfaz, mensajes, documentación y comentarios en español neutro.
- Crea CLAUDE.md con las convenciones del proyecto y mantenlo actualizado.

FORMA DE TRABAJAR
- Sigue las fases de la sección 14 de la especificación, en orden. Empieza cada fase con un plan corto.
- Al terminar cada fase: corre lint, typecheck, tests y build; haz commit con un mensaje claro (si trabajas en la nube, en una rama por fase y abre un pull request); y dame un resumen corto de lo hecho, cómo probarlo y qué necesitas de mí para la siguiente fase. Espera mi confirmación antes de pasar a la siguiente.
- En la fase 2, antes de calcular indicadores, inspecciona mensajes reales de la subcuenta de prueba (con el PIT de las variables de entorno) y documenta en docs/mapeo-origen.md cómo distinguir mensajes manuales, de workflow, del agente de IA y de campañas. Muéstramelo para aprobarlo. Si la red no permite llegar a la API de GHL, avísame en vez de suponer el formato.
- Verifica en la documentación oficial de GHL el header Version, los parámetros y la paginación de cada endpoint antes de usarlo; no los supongas.

DESPLIEGUE (fase 7, obligatorio)
- El despliegue lo ejecuto yo desde mi PC con Windows, solo con scripts de PowerShell (ssh y scp de OpenSSH de Windows), hacia el servidor donde ya corre Driven Conteo. Tú no te conectas al servidor: escribes y pruebas los scripts.
- Entrega los scripts de scripts/deploy/ descritos en la sección 13 de la especificación (00 a 08 + config.example.psd1), compatibles con Windows PowerShell 5.1 y PowerShell 7. Valida su sintaxis con PSScriptAnalyzer si está disponible.
- Entrega docs/DEPLOY.md: guía paso a paso para alguien sin experiencia, con cada comando listo para copiar y pegar en PowerShell, qué debe verse en pantalla en cada paso y qué hacer si algo falla. Debe cubrir: clonar el repositorio en mi PC, primera instalación, crear el primer administrador, carga histórica, actualizar a una nueva versión, revertir y sacar respaldo.
- Ningún script debe tocar Driven Conteo. Antes de cualquier acción que modifique el servidor (crear esquema y roles, recargar el proxy), el script muestra lo que va a hacer y pide confirmación.
- Al final, dame en el chat el resumen del paso a paso para desplegar, con los comandos exactos en orden.

Empieza leyendo ESPECIFICACION.md y los archivos de diseno/, y luego hazme las preguntas iniciales.
```
