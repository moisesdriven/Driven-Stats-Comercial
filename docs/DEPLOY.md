# Despliegue de Driven Comercial

Guía paso a paso para instalar y mantener Driven Comercial en el servidor donde ya corre Driven
Conteo, **desde una PC con Windows y solo con PowerShell**. No hace falta saber Docker ni Linux:
cada paso dice qué escribir, qué debe verse y qué hacer si falla.

## Cómo queda instalado

```
Servidor (Ubuntu)
└── /opt/driven-comercial/
    ├── docker-compose.yml      ← lo sube 01-preparar-servidor.ps1
    ├── .env                    ← secretos, permisos 600, lo genera 01 (nunca sale del servidor)
    ├── sql/esquema_y_roles.sql
    └── respaldos/              ← respaldos de 07-respaldo.ps1

Contenedores (proyecto Docker "driven-comercial")
├── comercial-db      PostgreSQL 16 propio, sin puertos publicados, red "comercial"
├── comercial-web     la web, en 127.0.0.1:3100 y publicada por Traefik con HTTPS
└── comercial-worker  cargas desde GHL, cálculo diario, análisis de calidad y purga
```

- **No se toca nada de Driven Conteo ni de DrivenBox** (ni `drivenbox-db`, ni sus redes, ni la
  configuración de Traefik). La única red ajena que se usa es `web`, la de Traefik, y solo para que
  la web se publique.
- La web se publica con etiquetas de Docker que Traefik lee solo: **no hay que editar ni recargar
  Traefik**. El dominio es `comercial.drivenbox.drivenautomations.com` y el certificado HTTPS lo
  obtiene Traefik con Let's Encrypt.
- Ningún secreto se guarda en tu PC ni se escribe en la línea de comandos.

## Opción recomendada para este servidor: desde su terminal

Driven Conteo se desplegó con comandos en la terminal del servidor (como `root`). Driven Comercial
se puede desplegar igual con `scripts/deploy/servidor.sh`, que hace lo mismo que los scripts de
PowerShell pero construye las imágenes en el propio servidor: no hace falta una PC con Windows ni
esperar a GHCR.

### Primera instalación

1. **Token de GitHub de solo lectura** (el repositorio es privado): GitHub → _Settings → Developer
   settings → Personal access tokens → Fine-grained tokens → Generate new token_. Repositorio:
   `moisesdriven/Driven-Stats-Comercial`; permiso _Contents: Read-only_. Cópialo.
2. **Código en el servidor.** Git pedirá usuario (tu usuario de GitHub) y contraseña (pega el
   token; no se ve al escribir). El token no queda guardado.

   ```bash
   git clone --branch main https://github.com/moisesdriven/Driven-Stats-Comercial.git /opt/driven-comercial/codigo
   ```

3. **Instalar**, un comando a la vez:

   ```bash
   cd /opt/driven-comercial/codigo/scripts/deploy
   bash servidor.sh preparar      # pide la clave de Anthropic (Enter para dejarla vacía)
   bash servidor.sh base          # escribe SI
   bash servidor.sh desplegar     # construye las imágenes (5–10 min la primera vez)
   bash servidor.sh admin tu-correo@empresa.com "Tu Nombre"
   bash servidor.sh verificar
   ```

   Cada comando termina con `LISTO` (verde) o `FALLÓ` (rojo, con el motivo). `admin` muestra la
   contraseña temporal una sola vez.

### Mantenimiento

| Necesito…                                         | Comando (en `/opt/driven-comercial/codigo/scripts/deploy`)                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Actualizar a lo último de `main`                  | `bash servidor.sh respaldo && bash servidor.sh actualizar` (git pedirá el token) |
| Volver a la versión anterior                      | `bash servidor.sh revertir`                                                      |
| Respaldo                                          | `bash servidor.sh respaldo` (queda en `/opt/driven-comercial/respaldos`)         |
| Carga histórica                                   | `bash servidor.sh historico 90` o `bash servidor.sh historico 90 LOCATION_ID`    |
| Recalcular indicadores (tras un cambio de reglas) | `bash servidor.sh recalcular 90` (no consulta GHL)                               |
| Estado general                                    | `bash servidor.sh verificar`                                                     |

Las secciones siguientes describen los scripts de PowerShell (desde una PC con Windows). Ambos
caminos usan la misma carpeta `/opt/driven-comercial`, el mismo `.env` y los mismos contenedores;
conviene usar siempre el mismo.

## Antes de empezar (una sola vez)

### 1. En tu PC con Windows

1. **PowerShell**: sirve el que viene con Windows (5.1) o PowerShell 7. Para ver la versión, abre
   PowerShell y escribe:

   ```powershell
   $PSVersionTable.PSVersion
   ```

2. **Cliente OpenSSH** (`ssh` y `scp`): viene en Windows 10 y 11. Compruébalo con:

   ```powershell
   ssh -V
   ```

   Si dice que no existe: _Configuración → Aplicaciones → Características opcionales → Agregar una
   característica → Cliente OpenSSH_.

3. **El código del proyecto** en tu PC (descargado de GitHub o con `git clone`). Todos los comandos
   de esta guía se ejecutan desde su carpeta `scripts\deploy`:

   ```powershell
   cd C:\ruta\a\Driven-Stats-Comercial\scripts\deploy
   ```

4. Si Windows no deja ejecutar scripts ("la ejecución de scripts está deshabilitada"), permítelo solo
   para esta ventana:

   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   ```

### 2. Acceso al servidor

Necesitas poder entrar por SSH con un usuario que pueda usar Docker. Pruébalo:

```powershell
ssh usuario@IP-DEL-SERVIDOR "docker ps"
```

Debe mostrar la lista de contenedores (los de Driven Conteo, Traefik, etc.). Si pide contraseña
cada vez, puedes configurar una llave SSH (opcional); los scripts funcionan igual pidiendo la
contraseña.

### 3. DNS del dominio

El dominio `comercial.drivenbox.drivenautomations.com` debe apuntar a la IP del servidor (registro A
en el proveedor del dominio). Sin eso, Traefik no puede emitir el certificado.

### 4. Archivo de configuración

```powershell
Copy-Item config.example.psd1 config.psd1
notepad config.psd1
```

Completa `Servidor`, `Usuario` y, si hace falta, `PuertoSsh`. El resto ya trae los valores de este
servidor. `config.psd1` no lleva contraseñas y no se sube al repositorio.

> **Etiqueta**: para producción conviene usar el commit publicado por GitHub Actions (por ejemplo
> `Etiqueta = '4ee491c…'`, los 40 caracteres que muestra GitHub) en lugar de `latest`, para saber
> siempre qué versión está instalada.

## Primera instalación

Ejecuta los scripts en orden. Cada uno muestra sus pasos numerados y termina con
**`LISTO: … terminó correctamente.`** (en verde) o **`FALLÓ: …`** (en rojo, con el motivo).

### Paso 0 · Verificar requisitos (no cambia nada)

```powershell
.\00-verificar-requisitos.ps1
```

Debe verse `OK` en: PowerShell, ssh y scp, conexión con el servidor, Docker, Docker Compose, disco
(10 GB o más), memoria, puerto 3100 libre y red de Traefik `web`. Los `AVISO` de "aún no existe"
(carpeta y base) son normales en la primera instalación.

| Si ves                                       | Qué hacer                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ssh no está instalado`                      | Instala el Cliente OpenSSH (ver arriba).                                               |
| `no puede usar Docker`                       | En el servidor: `sudo usermod -aG docker USUARIO`, cierra la sesión y vuelve a entrar. |
| `El puerto 3100 ya está en uso`              | Cambia `PuertoWeb` en `config.psd1` (por ejemplo 3101).                                |
| `No existe la red de Docker 'web'`           | Traefik no corre como se esperaba: avisa antes de seguir.                              |
| `Ya existe un contenedor … de otro proyecto` | Hay un conflicto de nombres: avisa antes de seguir; no borres nada.                    |

### Paso 1 · Preparar el servidor

```powershell
.\01-preparar-servidor.ps1
```

Qué hace: crea `/opt/driven-comercial`, sube `docker-compose.yml` y el SQL, y genera el `.env` con
contraseñas aleatorias (permisos 600). Te pedirá:

1. **Clave de la API de Anthropic**: pégala (no se ve al escribir) o pulsa Enter para dejarla vacía
   y agregarla después. Sin ella, los análisis de calidad quedan en espera; todo lo demás funciona.
2. **Token de GitHub** (solo si las imágenes son privadas): un token con permiso `read:packages`.
   Se crea en GitHub → _Settings → Developer settings → Personal access tokens_.
3. Si tu usuario no puede crear la carpeta, el servidor pedirá tu contraseña de `sudo`.

> **Importante:** el `.env` contiene `CLAVE_CIFRADO`, que descifra los tokens de GHL guardados. Si
> se pierde, habrá que volver a dar de alta los tokens. Por eso el script **nunca reemplaza un
> `.env` existente** salvo que uses `-ReemplazarEnv` (y aun así guarda una copia).

### Paso 2 · Crear la base, los esquemas y los roles

```powershell
.\02-crear-esquema-y-roles.ps1
```

Escribe `SI` cuando lo pida. Levanta `comercial-db` (el PostgreSQL propio de Driven Comercial) y
crea los esquemas `comercial` y `comercial_cola` y los roles `comercial_migrador`,
`comercial_worker` y `comercial_web`. Al final debe verse:

```
    roles: 3
    esquemas: comercial, comercial_cola
```

No pide la contraseña del administrador de PostgreSQL: como la base es propia, el script entra por
el socket local del contenedor. Se puede repetir sin problemas (es idempotente).

### Paso 3 · Desplegar

```powershell
.\03-desplegar.ps1
```

Descarga las imágenes de GHCR, guarda la versión anterior (si hay), aplica las migraciones con el
rol migrador, levanta la web y el worker, y espera a que estén sanos. Debe terminar con:

```
    comercial-web: healthy
    comercial-worker: iniciado
[6] Healthcheck
    {"estado":"ok","servicio":"web",...}
    OK  Driven Comercial … desplegado: https://comercial.drivenbox.drivenautomations.com
```

Sin acceso a GHCR (o para probar cambios que aún no están en `main`), puedes construir en tu PC con
Docker Desktop:

```powershell
.\03-desplegar.ps1 -Origen Local
```

### Paso 4 · Crear el primer administrador

```powershell
.\04-crear-admin.ps1 -Correo tu-correo@empresa.com -Nombre "Tu Nombre"
```

Muestra una **contraseña temporal una sola vez**: cópiala. Entra en
`https://comercial.drivenbox.drivenautomations.com`, ingresa con ese correo y esa contraseña, y el
sistema te pedirá cambiarla.

### Paso 5 · Verificar

```powershell
.\05-verificar.ps1
```

Debe mostrar los 3 contenedores `Up` (db y web con `healthy`), `/api/salud` respondiendo y
`HTTPS responde 200`. En una instalación nueva el certificado puede tardar 1 o 2 minutos: si el
paso 3 da aviso, espera y repite.

### Paso 6 · Dar de alta la subcuenta y cargar su historial

1. En la web: **Configuración → Subcuentas y tokens**, pega el `locationId` y el token privado
   (PIT) de solo lectura de la subcuenta. El sistema prueba cada permiso antes de guardarlo.
2. En **Configuración → Subcuentas y tokens** elige la zona horaria correcta (Jade18K: Lima).
3. Lanza la carga histórica (solo lectura sobre GHL):

   ```powershell
   .\08-carga-historica.ps1 -Dias 90
   ```

   Para una sola subcuenta: `.\08-carga-historica.ps1 -Subcuenta 93mgPQwURqpEvyzZcf9m -Dias 90`.
   El avance se ve en `.\05-verificar.ps1` (paso 5) o en el servidor con
   `docker logs -f comercial-worker`.

4. En **Metas y etapas**, revisa las metas y elige las 3 etapas de calidad; en **Horarios**, el
   horario de cada asesor o el modo "Tiempo corrido".

## Actualizar a una versión nueva

Cuando GitHub Actions publica una versión nueva (al hacer merge a `main`):

```powershell
.\07-respaldo.ps1
.\03-desplegar.ps1 -Etiqueta COMMIT-NUEVO
.\05-verificar.ps1
```

`03-desplegar.ps1` guarda automáticamente la versión que estaba corriendo para poder revertir.

## Revertir a la versión anterior

```powershell
.\06-revertir.ps1
```

Escribe `SI`. Vuelve web y worker a la versión anterior en menos de un minuto. Las migraciones de la
base no se deshacen: solo agregan tablas o columnas, así que la versión anterior sigue funcionando.
Para volver a la nueva, ejecuta otra vez `03-desplegar.ps1`.

## Respaldo y restauración

### Respaldo

```powershell
.\07-respaldo.ps1
```

Genera `comercial-AAAAMMDD-HHMMSS.dump` (formato comprimido de `pg_dump`, solo el esquema
`comercial`), lo descarga a `Documentos\DrivenComercial\respaldos` y conserva en el servidor los
últimos 7. El respaldo tiene datos sensibles (tokens cifrados y textos de mensajes de hasta 90
días): guárdalo en un lugar seguro. Los tokens solo se pueden descifrar con la `CLAVE_CIFRADO` del
`.env` del servidor, que no va dentro del respaldo.

### Restaurar (solo si se perdió la base)

En el servidor (`ssh usuario@IP-DEL-SERVIDOR`), con el archivo en `/opt/driven-comercial/respaldos`:

```bash
cd /opt/driven-comercial
docker compose stop web worker
docker exec comercial-db psql -U postgres -d comercial -c "DROP SCHEMA comercial CASCADE"
docker exec -i comercial-db pg_restore -U postgres -d comercial < respaldos/ARCHIVO.dump
docker compose up -d web worker
```

Si la base se recreó desde cero, ejecuta antes `.\02-crear-esquema-y-roles.ps1`. Para subir un
respaldo desde tu PC: `scp -P 22 ARCHIVO.dump usuario@IP-DEL-SERVIDOR:/opt/driven-comercial/respaldos/`.

## Tareas frecuentes

| Necesito…                                     | Cómo                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Agregar o cambiar la clave de Anthropic       | En el servidor: `cd /opt/driven-comercial && nano .env`, edita `ANTHROPIC_API_KEY=`, guarda y ejecuta `docker compose up -d worker web`. |
| Ver los logs en vivo                          | En el servidor: `docker logs -f comercial-worker` (o `comercial-web`). Ctrl+C para salir.                                                |
| Otro administrador                            | `.\04-crear-admin.ps1 -Correo … -Nombre "…"` (o desde la web, en Usuarios y accesos).                                                    |
| Borrar a mano los textos de más de 90 días    | Corre solo cada día a las 03:30; a mano: `docker exec comercial-worker node dist/cli.js purga`.                                          |
| Ejecutar los scripts desde el propio servidor | Instala PowerShell 7 en el servidor y pon `Transporte = 'local'` en `config.psd1`.                                                       |

## Si algo falla

1. Lee el mensaje rojo `FALLÓ:` y las líneas anteriores: el script muestra la salida del servidor y,
   si un contenedor no arranca, sus últimas 40 líneas de log.
2. Ejecuta `.\05-verificar.ps1` para ver el estado general.
3. Problemas conocidos:

| Mensaje                                                    | Causa y solución                                                                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `Falta .env o docker-compose.yml`                          | No se ejecutó `01-preparar-servidor.ps1`.                                                                                  |
| `Faltan los roles: ejecuta antes 02-…`                     | Ejecuta `02-crear-esquema-y-roles.ps1` y vuelve a desplegar.                                                               |
| `denied` o `unauthorized` al descargar de ghcr.io          | Token de GitHub vencido o sin `read:packages`: en el servidor `docker logout ghcr.io` y repite `01-preparar-servidor.ps1`. |
| `manifest unknown`                                         | Esa etiqueta no existe en GHCR: revisa el commit en GitHub → _Packages_.                                                   |
| `comercial-web: unhealthy` o `comercial-worker no arrancó` | Mira las líneas de log que muestra el script. Si empezó tras una actualización: `.\06-revertir.ps1`.                       |
| `permission denied for database comercial` en el worker    | El SQL de roles es antiguo: repite `02-crear-esquema-y-roles.ps1` (le da al worker el permiso que pg-boss necesita).       |
| `HTTPS respondió '000'` o `404`                            | DNS sin apuntar al servidor o certificado aún en trámite: espera 2 minutos; revisa el registro A del dominio.              |

## Despliegue de prueba

El 16 de noviembre de 2026 se probó el ciclo completo con los scripts sobre un Docker limpio
(Ubuntu 24.04, Docker 29.9, Compose 5.6), con `Transporte = 'local'` y PowerShell 7.4: requisitos,
preparación (`.env` con permisos 600), esquemas y roles (dos veces, idempotente), despliegue con
`-Origen Local`, creación del administrador, verificación, actualización a una segunda etiqueta,
reversión, respaldo descargado y restaurado (en una base aparte y sobre la misma base con el
procedimiento de arriba: dueños y permisos intactos, migraciones al día) y carga histórica encolada. La prueba encontró y corrigió dos errores: el worker no arrancaba con su rol de producción
(pg-boss necesita `CREATE` sobre la base) y el despliegue no detectaba un worker que se reiniciaba.
Falta la prueba por SSH desde Windows contra el servidor real.
