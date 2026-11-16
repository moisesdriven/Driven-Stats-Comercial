<#
.SYNOPSIS
  Lanza la carga histórica desde GHL (solo lectura) para una o todas las subcuentas activas.
.DESCRIPTION
  Por defecto la encola en el worker (sync-historico) y vuelve enseguida; el avance se ve en los logs.
  Con -Directo la ejecuta en primer plano y muestra el resultado al terminar (puede tardar).
.EXAMPLE
  .\08-carga-historica.ps1 -Dias 90
.EXAMPLE
  .\08-carga-historica.ps1 -Subcuenta 93mgPQwURqpEvyzZcf9m -Dias 30 -Directo
#>
[CmdletBinding()]
param(
    [string]$Config = (Join-Path $PSScriptRoot 'config.psd1'),
    [string]$Subcuenta,
    [ValidateRange(1, 365)] [int]$Dias = 90,
    [switch]$Directo
)
. "$PSScriptRoot\comun.ps1"

Invoke-Script '08 · Carga histórica' {
    $cfg = Import-ConfigDespliegue $Config
    if ($Subcuenta -and $Subcuenta -notmatch '^[A-Za-z0-9_-]+$') { throw 'locationId inválido.' }
    $argumentos = "historico --dias $Dias"
    if ($Subcuenta) { $argumentos += " --subcuenta $Subcuenta" }
    if ($Directo) { $argumentos += ' --directo' }

    Write-Paso 1 "Carga de $Dias días ($(if ($Subcuenta) { "subcuenta $Subcuenta" } else { 'todas las subcuentas activas' }))"
    Invoke-Remoto $cfg "docker exec comercial-worker node dist/cli.js $argumentos"
    if (-not $Directo) { Write-Host '    Avance: .\05-verificar.ps1 (paso 5) o en el servidor: docker logs -f comercial-worker' }
    Write-Ok 'Carga lanzada'
}
