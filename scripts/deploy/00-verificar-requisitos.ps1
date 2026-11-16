<#
.SYNOPSIS
  Verifica los requisitos en tu PC y en el servidor. No cambia nada.
.EXAMPLE
  .\00-verificar-requisitos.ps1
#>
[CmdletBinding()]
param([string]$Config = (Join-Path $PSScriptRoot 'config.psd1'))
. "$PSScriptRoot\comun.ps1"

Invoke-Script '00 · Verificar requisitos' {
    $cfg = Import-ConfigDespliegue $Config
    $faltas = 0

    Write-Paso 1 'PowerShell en esta PC'
    $v = $PSVersionTable.PSVersion
    if ($v.Major -ge 7 -or ($v.Major -eq 5 -and $v.Minor -ge 1)) { Write-Ok "PowerShell $v" } else { Write-Fallo "PowerShell ${v}: se necesita 5.1 o 7"; $faltas++ }

    Write-Paso 2 'Programas en esta PC'
    $necesarios = @('ssh', 'scp')
    if ($cfg.Transporte -eq 'local') { $necesarios = @('bash') }
    foreach ($p in $necesarios) {
        if (Get-Command $p -ErrorAction SilentlyContinue) { Write-Ok $p } else { Write-Fallo "$p no está instalado (Windows: Configuración > Aplicaciones > Características opcionales > Cliente OpenSSH)"; $faltas++ }
    }
    foreach ($p in @('git', 'docker')) {
        if (Get-Command $p -ErrorAction SilentlyContinue) { Write-Ok "$p (opcional)" } else { Write-Aviso "$p no está instalado: solo hace falta para 03-desplegar.ps1 -Origen Local" }
    }

    Write-Paso 3 "Conexión con el servidor ($($cfg.Transporte))"
    $nombre = Invoke-Remoto $cfg 'echo "conectado a $(hostname) como $(id -un)"' -Capturar
    Write-Ok ($nombre -join ' ')

    Write-Paso 4 'Servidor: sistema, Docker, disco, memoria, puerto, red de Traefik y contenedores'
    $puerto = [int]$cfg.PuertoWeb
    $red = ConvertTo-Bash $cfg.RedTraefik
    $ruta = ConvertTo-Bash $cfg.RutaRemota
    $salida = Invoke-Remoto $cfg -Capturar -PermitirFallo @"
falta=0
ok() { echo "OK|`$1"; }
mal() { echo "MAL|`$1"; falta=1; }
aviso() { echo "AVISO|`$1"; }
. /etc/os-release 2>/dev/null && ok "Sistema: `$PRETTY_NAME" || aviso "No se pudo leer /etc/os-release"
if command -v docker >/dev/null; then ok "Docker `$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?')"; else mal 'Docker no está instalado'; fi
if docker info >/dev/null 2>&1; then ok "El usuario `$(id -un) puede usar Docker"; else mal "El usuario `$(id -un) no puede usar Docker (agrégalo al grupo docker)"; fi
if docker compose version >/dev/null 2>&1; then ok "Docker Compose `$(docker compose version --short)"; else mal 'Falta Docker Compose v2 (docker compose)'; fi
libre=`$(df -Pm / | awk 'NR==2 {print `$4}')
if [ "`$libre" -ge 10240 ]; then ok "Disco libre: `$((libre / 1024)) GB"; else mal "Poco disco libre: `$libre MB (se recomiendan 10 GB)"; fi
mem=`$(awk '/MemAvailable/ {print int(`$2/1024)}' /proc/meminfo)
if [ "`$mem" -ge 1024 ]; then ok "Memoria disponible: `$mem MB"; else mal "Poca memoria disponible: `$mem MB (se recomienda 1 GB)"; fi
if (ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null) | awk '{print `$4}' | grep -qE "[:.]$puerto`$"; then
  if docker ps --format '{{.Names}} {{.Ports}}' | grep -q "^comercial-web .*:$puerto->"; then ok "Puerto ${puerto}: lo usa comercial-web"; else mal "El puerto ${puerto} ya está en uso por otra aplicación: cambia PuertoWeb en config.psd1"; fi
else ok "Puerto $puerto libre"; fi
if docker network inspect $red >/dev/null 2>&1; then ok "Red de Traefik $($cfg.RedTraefik) encontrada (no se modifica)"; else mal "No existe la red de Docker $($cfg.RedTraefik) de Traefik"; fi
for c in comercial-db comercial-web comercial-worker; do
  if docker ps -a --format '{{.Names}}' | grep -qx "`$c"; then
    proyecto=`$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "`$c")
    if [ "`$proyecto" = driven-comercial ]; then ok "`$c ya existe (de Driven Comercial): `$(docker inspect -f '{{.State.Status}}' "`$c")"; else mal "Ya existe un contenedor `$c de otro proyecto (`$proyecto)"; fi
  fi
done
if docker ps --format '{{.Names}}' | grep -qx comercial-db; then
  if docker exec comercial-db pg_isready -U postgres -d comercial >/dev/null; then ok 'PostgreSQL propio (comercial-db) responde'; else mal 'comercial-db no responde'; fi
else aviso 'PostgreSQL propio (comercial-db) aún no existe: lo crea 02-crear-esquema-y-roles.ps1'; fi
if [ -d $ruta ]; then ok "Carpeta $($cfg.RutaRemota) existe"; else aviso "Carpeta $($cfg.RutaRemota) aún no existe: la crea 01-preparar-servidor.ps1"; fi
exit `$falta
"@
    foreach ($l in $salida) {
        $partes = "$l".Split('|', 2)
        if ($partes.Count -lt 2) { Write-Host "    $l"; continue }
        switch ($partes[0]) { 'OK' { Write-Ok $partes[1] } 'MAL' { Write-Fallo $partes[1]; $faltas++ } 'AVISO' { Write-Aviso $partes[1] } }
    }

    if ($faltas -gt 0) { throw "Hay $faltas requisito(s) sin cumplir." }
}
