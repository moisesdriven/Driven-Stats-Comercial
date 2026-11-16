<#
.SYNOPSIS
  Crea la carpeta en el servidor, sube docker-compose y el SQL, y genera el .env remoto (permisos 600).
.DESCRIPTION
  Las contraseñas de la base, la clave de cifrado y el secreto de sesión se generan al azar y se
  escriben directamente en el servidor: nunca se guardan en tu PC. Solo se te pide la clave de
  Anthropic (opcional) y, si las imágenes son privadas, un token de GitHub de solo lectura.
  Si el .env ya existe NO se reemplaza (contiene la clave que descifra los tokens de GHL).
.EXAMPLE
  .\01-preparar-servidor.ps1
#>
[CmdletBinding()]
param(
    [string]$Config = (Join-Path $PSScriptRoot 'config.psd1'),
    # Reemplaza un .env existente (guarda una copia .env.respaldo-FECHA). Solo si sabes lo que haces.
    [switch]$ReemplazarEnv
)
. "$PSScriptRoot\comun.ps1"

Invoke-Script '01 · Preparar el servidor' {
    $cfg = Import-ConfigDespliegue $Config
    $ruta = ConvertTo-Bash $cfg.RutaRemota

    Write-Paso 1 "Carpeta $($cfg.RutaRemota)"
    $estado = Invoke-Remoto $cfg -Capturar @"
if [ -d $ruta ] && [ -w $ruta ]; then echo existe
elif [ -w "`$(dirname $ruta)" ] || [ "`$(id -u)" = 0 ]; then mkdir -p $ruta/sql $ruta/respaldos && echo creada
else echo sudo; fi
"@
    if (($estado -join '') -eq 'sudo') {
        Write-Aviso 'Se necesita sudo para crear la carpeta: el servidor puede pedirte tu contraseña de usuario.'
        Invoke-RemotoInteractivo $cfg "sudo mkdir -p $ruta && sudo chown `"`$(id -un):`$(id -gn)`" $ruta"
    }
    Invoke-Remoto $cfg "mkdir -p $ruta/sql $ruta/respaldos && chmod 750 $ruta && echo lista"
    Write-Ok 'Carpeta lista'

    Write-Paso 2 'Subir docker-compose.yml y el SQL de esquemas y roles'
    Send-Archivo $cfg (Join-Path $script:RaizRepo 'docker\docker-compose.prod.yml') "$($cfg.RutaRemota)/docker-compose.yml"
    Send-Archivo $cfg (Join-Path $script:RaizRepo 'scripts\sql\esquema_y_roles.sql') "$($cfg.RutaRemota)/sql/esquema_y_roles.sql"
    Write-Ok 'Archivos subidos'

    Write-Paso 3 'Archivo .env del servidor'
    $existe = (Invoke-Remoto $cfg "[ -f $ruta/.env ] && echo si || echo no" -Capturar) -join ''
    if ($existe -eq 'si' -and -not $ReemplazarEnv) {
        Write-Ok '.env ya existe: se conserva (para reemplazarlo usa -ReemplazarEnv).'
    } else {
        if ($existe -eq 'si' -and -not (Confirm-Accion 'Vas a REEMPLAZAR el .env. Los tokens de GHL guardados dejarán de poder leerse y habrá que darlos de alta otra vez.')) {
            throw 'Cancelado: el .env no se modificó.'
        }
        $anthropic = Read-Secreto 'Clave de la API de Anthropic (Enter para dejarla vacía; se puede agregar después)'
        if ($anthropic -match '\s|''') { throw 'La clave de Anthropic no puede tener espacios ni comillas.' }
        $pg = New-ClaveAleatoria 24
        $mig = New-ClaveAleatoria 24
        $wrk = New-ClaveAleatoria 24
        $web = New-ClaveAleatoria 24
        $lineas = @(
            '# Generado por scripts/deploy/01-preparar-servidor.ps1. Permisos 600. No copiar fuera del servidor.',
            "POSTGRES_PASSWORD=$pg",
            "DATABASE_URL=postgres://comercial_web:$web@comercial-db:5432/comercial",
            "DATABASE_URL_WORKER=postgres://comercial_worker:$wrk@comercial-db:5432/comercial",
            "DATABASE_URL_MIGRADOR=postgres://comercial_migrador:$mig@comercial-db:5432/comercial",
            "CLAVE_CIFRADO=$(New-ClaveAleatoria 32 -Base64)",
            "SESION_SECRETO=$(New-ClaveAleatoria 32)",
            "URL_PUBLICA=https://$($cfg.Dominio)",
            'GHL_URL_APP=https://app.gohighlevel.com',
            'SYNC_NOCTURNO_HORA=02:30',
            'SYNC_INCREMENTAL_MINUTOS=15',
            'GHL_MAX_LLAMADAS_10S=80',
            "ANTHROPIC_API_KEY=$anthropic",
            'IA_MODELO=claude-haiku-5-5',
            'IA_ESFUERZO=low',
            'IA_PENSAMIENTO=no',
            'IA_TOPE_MENSUAL_USD=10',
            'CALIDAD_MUESTRA_CONVERSACIONES=1000',
            'CALIDAD_MAX_MENSAJES_CONVERSACION=10',
            'CALIDAD_MAX_MANUALES_MES=3',
            'CALIDAD_SALUDOS_POR_REGLA=si',
            'MODO_ALERTAS=sombra',
            'ZONA_HORARIA_DEFECTO=America/Lima',
            "PUERTO_WEB=$($cfg.PuertoWeb)",
            "DOMINIO=$($cfg.Dominio)",
            'LOG_NIVEL=info',
            "IMAGEN_WEB=$($cfg.ImagenWeb)",
            "IMAGEN_WORKER=$($cfg.ImagenWorker)",
            "ETIQUETA=$($cfg.Etiqueta)"
        )
        $contenido = ($lineas -join "`n")
        Invoke-Remoto $cfg @"
umask 077
if [ -f $ruta/.env ]; then cp -p $ruta/.env "$ruta/.env.respaldo-`$(date +%Y%m%d-%H%M%S)"; fi
cat > $ruta/.env.nuevo <<'FIN_ENV_DRIVEN'
$contenido
FIN_ENV_DRIVEN
chmod 600 $ruta/.env.nuevo
mv $ruta/.env.nuevo $ruta/.env
echo ".env escrito con permisos `$(stat -c %a $ruta/.env)"
"@
        $anthropic = $null; $pg = $null; $mig = $null; $wrk = $null; $web = $null; $contenido = $null; $lineas = $null
        Write-Ok '.env generado en el servidor. La clave de cifrado vive solo allí: no la borres.'
    }

    Write-Paso 4 'Acceso a las imágenes de GHCR'
    if ($cfg.RegistroPrivado) {
        $ya = (Invoke-Remoto $cfg "grep -q 'ghcr.io' ~/.docker/config.json 2>/dev/null && echo si || echo no" -Capturar) -join ''
        if ($ya -eq 'si') {
            Write-Ok 'El servidor ya tiene acceso a ghcr.io.'
        } else {
            $usuario = $cfg.UsuarioGithub
            if ([string]::IsNullOrWhiteSpace($usuario)) { $usuario = Read-Host 'Usuario de GitHub' }
            $token = Read-Secreto 'Token de GitHub con permiso read:packages (no se guarda en tu PC)'
            if ($token -match '\s|''') { throw 'El token no puede tener espacios ni comillas.' }
            Invoke-Remoto $cfg "printf '%s' '$token' | docker login ghcr.io -u $(ConvertTo-Bash $usuario) --password-stdin"
            $token = $null
            Write-Ok 'Acceso a ghcr.io configurado.'
        }
    } else {
        Write-Ok 'Imágenes públicas: no hace falta iniciar sesión.'
    }

    Write-Paso 5 "Red de Traefik '$($cfg.RedTraefik)'"
    Invoke-Remoto $cfg "docker network inspect $(ConvertTo-Bash $cfg.RedTraefik) >/dev/null && echo 'existe (no se modifica)'"
    Write-Ok 'Servidor preparado. Siguiente: .\02-crear-esquema-y-roles.ps1'
}
