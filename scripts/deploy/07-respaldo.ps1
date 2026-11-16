<#
.SYNOPSIS
  Respaldo del esquema comercial (pg_dump comprimido) y descarga a esta PC.
.DESCRIPTION
  El respaldo contiene datos sensibles (tokens cifrados, textos de mensajes de hasta 90 días): guárdalo
  en un lugar seguro. Los tokens solo se pueden descifrar con la CLAVE_CIFRADO del .env del servidor,
  que NO va en el respaldo.
.EXAMPLE
  .\07-respaldo.ps1
#>
[CmdletBinding()]
param(
    [string]$Config = (Join-Path $PSScriptRoot 'config.psd1'),
    [string]$Destino
)
. "$PSScriptRoot\comun.ps1"

Invoke-Script '07 · Respaldo' {
    $cfg = Import-ConfigDespliegue $Config
    if (-not $Destino) { $Destino = $cfg.CarpetaRespaldos }
    if ($Destino.StartsWith('~')) { $Destino = Join-Path $HOME $Destino.Substring(1).TrimStart('\', '/') }
    New-Item -ItemType Directory -Force -Path $Destino | Out-Null
    $conservar = [int]$cfg.RespaldosEnServidor

    Write-Paso 1 'Generar el respaldo en el servidor'
    $archivo = (Invoke-Remoto $cfg @"
mkdir -p respaldos && chmod 700 respaldos
f="respaldos/comercial-`$(date +%Y%m%d-%H%M%S).dump"
docker exec comercial-db pg_dump -U postgres -d comercial -n comercial -Fc -Z 9 > "`$f.tmp"
mv "`$f.tmp" "`$f" && chmod 600 "`$f"
ls -1t respaldos/comercial-*.dump | tail -n +$($conservar + 1) | xargs -r rm -f
echo "`$f"
"@ -Capturar | Select-Object -Last 1)
    Write-Ok "Respaldo creado: $archivo"

    Write-Paso 2 "Descargar a $Destino"
    $local = Join-Path $Destino (Split-Path $archivo -Leaf)
    Receive-Archivo $cfg "$($cfg.RutaRemota)/$archivo" $local
    $mb = [math]::Round((Get-Item $local).Length / 1MB, 1)
    Write-Ok "Descargado: $local ($mb MB). En el servidor se conservan los últimos $conservar."
}
