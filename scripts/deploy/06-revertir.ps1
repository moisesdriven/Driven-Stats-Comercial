<#
.SYNOPSIS
  Vuelve web y worker a la versión anterior guardada por 03-desplegar.ps1.
.DESCRIPTION
  Las migraciones de la base no se deshacen (solo agregan columnas o tablas), así que la versión
  anterior sigue funcionando con la base actual. Para volver a la nueva, ejecuta 03-desplegar.ps1.
.EXAMPLE
  .\06-revertir.ps1
#>
[CmdletBinding()]
param([string]$Config = (Join-Path $PSScriptRoot 'config.psd1'))
. "$PSScriptRoot\comun.ps1"

Invoke-Script '06 · Revertir' {
    $cfg = Import-ConfigDespliegue $Config
    $webAnt = ConvertTo-Bash "$($cfg.ImagenWeb):anterior"
    $wrkAnt = ConvertTo-Bash "$($cfg.ImagenWorker):anterior"

    Write-Paso 1 'Versión anterior'
    $anterior = (Invoke-Remoto $cfg @"
docker image inspect $webAnt $wrkAnt >/dev/null 2>&1 || { echo 'NO_HAY'; exit 0; }
cat .etiqueta-anterior 2>/dev/null || echo desconocida
"@ -Capturar) -join ''
    if ($anterior -eq 'NO_HAY') { throw 'No hay una versión anterior guardada en el servidor (se guarda al desplegar una actualización).' }
    Write-Host "    Se volverá a: $anterior"
    if (-not (Confirm-Accion '¿Revertir web y worker a esa versión?')) { throw 'Cancelado por el usuario.' }

    Write-Paso 2 'Cambiar a la versión anterior'
    Invoke-Remoto $cfg @"
actual=`$(sed -n 's/^ETIQUETA=//p' .env | head -n1)
sed -i 's/^ETIQUETA=.*/ETIQUETA=anterior/' .env
echo "`$actual" > .etiqueta-revertida
docker compose up -d web worker
$(Get-BashEsperarSalud 'comercial-web' 180)
"@
    Invoke-Remoto $cfg "docker exec comercial-web wget -qO- http://127.0.0.1:3100/api/salud && echo"
    Write-Ok "Revertido a $anterior. Para volver a desplegar la nueva: .\03-desplegar.ps1"
}
