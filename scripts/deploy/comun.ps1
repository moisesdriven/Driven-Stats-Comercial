# Funciones comunes de los scripts de despliegue. Compatible con Windows PowerShell 5.1 y PowerShell 7.
# Se carga con:  . "$PSScriptRoot\comun.ps1"

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Los scripts que se envían al servidor viajan en UTF-8 sin BOM (en 5.1 el valor por defecto es ASCII).
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

$script:RaizRepo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

$script:ValoresPorDefecto = @{
    PuertoSsh           = 22
    Transporte          = 'ssh'
    RutaRemota          = '/opt/driven-comercial'
    Dominio             = 'comercial.drivenbox.drivenautomations.com'
    PuertoWeb           = 3100
    ImagenWeb           = 'ghcr.io/moisesdriven/driven-comercial-web'
    ImagenWorker        = 'ghcr.io/moisesdriven/driven-comercial-worker'
    Etiqueta            = 'latest'
    RegistroPrivado     = $true
    UsuarioGithub       = ''
    RedTraefik          = 'web'
    CarpetaRespaldos    = '~\Documents\DrivenComercial\respaldos'
    RespaldosEnServidor = 7
}

function Write-Titulo([string]$Texto) {
    Write-Host ''
    Write-Host "=== $Texto ===" -ForegroundColor White
}
function Write-Paso([int]$Numero, [string]$Texto) { Write-Host ''; Write-Host "[$Numero] $Texto" -ForegroundColor Cyan }
function Write-Ok([string]$Texto) { Write-Host "    OK  $Texto" -ForegroundColor Green }
function Write-Aviso([string]$Texto) { Write-Host "    AVISO  $Texto" -ForegroundColor Yellow }
function Write-Fallo([string]$Texto) { Write-Host "    ERROR  $Texto" -ForegroundColor Red }

function Import-ConfigDespliegue {
    param([string]$Ruta = (Join-Path $PSScriptRoot 'config.psd1'))
    if (-not (Test-Path $Ruta)) {
        throw "No existe $Ruta. Copia config.example.psd1 como config.psd1 y completa los valores."
    }
    $leida = Import-PowerShellDataFile -Path $Ruta
    $cfg = @{}
    foreach ($k in $script:ValoresPorDefecto.Keys) { $cfg[$k] = $script:ValoresPorDefecto[$k] }
    foreach ($k in $leida.Keys) { $cfg[$k] = $leida[$k] }
    if ($cfg.Transporte -notin @('ssh', 'local')) { throw "Transporte debe ser 'ssh' o 'local'." }
    if ($cfg.Transporte -eq 'ssh') {
        foreach ($k in @('Servidor', 'Usuario')) {
            if (-not $cfg.ContainsKey($k) -or [string]::IsNullOrWhiteSpace([string]$cfg[$k]) -or ([string]$cfg[$k]).Contains('IP-O-NOMBRE') -or ([string]$cfg[$k]) -eq 'usuario-ssh') {
                throw "Completa '$k' en config.psd1."
            }
        }
    }
    if ($cfg.RutaRemota -notmatch '^/[A-Za-z0-9._/-]+$') { throw 'RutaRemota debe ser una ruta absoluta simple (ej. /opt/driven-comercial).' }
    if ($cfg.Etiqueta -notmatch '^[A-Za-z0-9._-]+$') { throw 'Etiqueta inválida.' }
    return $cfg
}

# Texto entre comillas simples para bash (escapa las comillas internas).
function ConvertTo-Bash([string]$Texto) { return "'" + $Texto.Replace("'", "'\''") + "'" }

function Get-DestinoSsh($Cfg) { return "$($Cfg.Usuario)@$($Cfg.Servidor)" }

# Ejecuta un script de bash en el servidor. El script viaja por la entrada estándar de ssh (nunca en la
# línea de comandos), así que puede llevar secretos sin que queden en el historial ni en la lista de
# procesos. Devuelve las líneas de salida si se pide -Capturar; si no, las muestra en pantalla.
function Invoke-Remoto {
    param(
        [Parameter(Mandatory)] $Cfg,
        [Parameter(Mandatory)] [string]$Script,
        [switch]$Capturar,
        [switch]$PermitirFallo
    )
    $cuerpo = "set -euo pipefail`nexec 2>&1`ncd $(ConvertTo-Bash $Cfg.RutaRemota) 2>/dev/null || true`n" + $Script
    $cuerpo = $cuerpo -replace "`r`n", "`n"
    if ($Cfg.Transporte -eq 'local') {
        $salida = $cuerpo | & bash -s
    } else {
        $salida = $cuerpo | & ssh -p $Cfg.PuertoSsh -o ServerAliveInterval=30 -o ConnectTimeout=15 (Get-DestinoSsh $Cfg) 'bash -s'
    }
    $codigo = $LASTEXITCODE
    if (-not $Capturar) { $salida | ForEach-Object { Write-Host "    $_" } }
    if ($codigo -ne 0 -and -not $PermitirFallo) {
        if ($Capturar) { $salida | ForEach-Object { Write-Host "    $_" } }
        throw "El comando en el servidor terminó con error (código $codigo)."
    }
    if ($Capturar) { return @($salida) }
}

# Comando interactivo (por ejemplo, sudo que pide contraseña). Sin secretos en la línea de comandos.
function Invoke-RemotoInteractivo($Cfg, [string]$Comando) {
    if ($Cfg.Transporte -eq 'local') { & bash -c $Comando } else { & ssh -t -p $Cfg.PuertoSsh (Get-DestinoSsh $Cfg) $Comando }
    if ($LASTEXITCODE -ne 0) { throw "El comando terminó con error (código $LASTEXITCODE)." }
}

function Send-Archivo($Cfg, [string]$Local, [string]$Remoto) {
    if (-not (Test-Path $Local)) { throw "No existe el archivo $Local." }
    if ($Cfg.Transporte -eq 'local') {
        Copy-Item -Path $Local -Destination $Remoto -Force
    } else {
        & scp -q -P $Cfg.PuertoSsh $Local "$(Get-DestinoSsh $Cfg):$Remoto"
        if ($LASTEXITCODE -ne 0) { throw "No se pudo copiar $Local al servidor." }
    }
}

function Receive-Archivo($Cfg, [string]$Remoto, [string]$Local) {
    if ($Cfg.Transporte -eq 'local') {
        Copy-Item -Path $Remoto -Destination $Local -Force
    } else {
        & scp -q -P $Cfg.PuertoSsh "$(Get-DestinoSsh $Cfg):$Remoto" $Local
        if ($LASTEXITCODE -ne 0) { throw "No se pudo descargar $Remoto." }
    }
}

# Pide un secreto sin mostrarlo ni guardarlo en el historial; lo devuelve como texto solo en memoria.
function Read-Secreto([string]$Pregunta) {
    $seguro = Read-Host -Prompt $Pregunta -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Confirm-Accion([string]$Pregunta, [string]$Palabra = 'SI') {
    $r = Read-Host -Prompt "$Pregunta Escribe $Palabra para continuar"
    return ($r -ceq $Palabra)
}

# Clave aleatoria criptográfica: hexadecimal (segura dentro de una URL) o base64.
function New-ClaveAleatoria([int]$Bytes = 24, [switch]$Base64) {
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    if ($Base64) { return [Convert]::ToBase64String($buffer) }
    return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

# Fragmento de bash: espera a que un contenedor quede "healthy" (o falla tras N segundos).
function Get-BashEsperarSalud([string]$Contenedor, [int]$Segundos = 180) {
    return @"
esperar_salud() {
  local c="`$1" limite="`$2" t=0 estado
  while [ "`$t" -lt "`$limite" ]; do
    estado=`$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "`$c" 2>/dev/null || echo ausente)
    if [ "`$estado" = healthy ]; then echo "`$c: healthy"; return 0; fi
    if [ "`$estado" = unhealthy ] || [ "`$estado" = exited ]; then echo "`$c: `$estado"; docker logs --tail 40 "`$c"; return 1; fi
    sleep 3; t=`$((t + 3))
  done
  echo "`$c: no quedó saludable en `$limite s (estado: `$estado)"; docker logs --tail 40 "`$c"; return 1
}
esperar_salud $Contenedor $Segundos
"@
}

# Ejecuta el bloque del script y termina con un mensaje claro de éxito o error.
function Invoke-Script([string]$Nombre, [scriptblock]$Bloque) {
    Write-Titulo $Nombre
    try {
        & $Bloque
        Write-Host ''
        Write-Host "LISTO: $Nombre terminó correctamente." -ForegroundColor Green
    } catch {
        Write-Host ''
        Write-Host "FALLÓ: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host 'Revisa el paso anterior y la sección "Si algo falla" de docs/DEPLOY.md.' -ForegroundColor Red
        exit 1
    }
}
