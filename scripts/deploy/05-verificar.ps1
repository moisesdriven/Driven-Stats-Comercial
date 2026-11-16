<#
.SYNOPSIS
  Estado de los contenedores, /api/salud, publicación por Traefik, últimas líneas de logs y cargas.
.EXAMPLE
  .\05-verificar.ps1
#>
[CmdletBinding()]
param(
    [string]$Config = (Join-Path $PSScriptRoot 'config.psd1'),
    [int]$Lineas = 20
)
. "$PSScriptRoot\comun.ps1"

Invoke-Script '05 · Verificar' {
    $cfg = Import-ConfigDespliegue $Config
    $dominio = ConvertTo-Bash $cfg.Dominio

    Write-Paso 1 'Contenedores'
    Invoke-Remoto $cfg @'
docker compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Image}}'
echo "Versión desplegada: $(sed -n 's/^ETIQUETA=//p' .env | head -n1)"
[ -f .etiqueta-anterior ] && echo "Versión anterior (para revertir): $(cat .etiqueta-anterior)" || true
'@

    Write-Paso 2 'Salud de la web (dentro del servidor)'
    Invoke-Remoto $cfg "docker exec comercial-web wget -qO- http://127.0.0.1:3100/api/salud && echo"
    Write-Ok '/api/salud responde'

    Write-Paso 3 "Publicación por Traefik (https://$($cfg.Dominio))"
    $codigo = (Invoke-Remoto $cfg "curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://$dominio/api/salud || echo sin-respuesta" -Capturar -PermitirFallo) -join ''
    if ($codigo -eq '200') { Write-Ok 'HTTPS responde 200' } else { Write-Aviso "HTTPS respondió '$codigo'. Si es una instalación nueva, espera 1–2 minutos al certificado; revisa también el DNS del dominio." }

    Write-Paso 4 "Últimas $Lineas líneas de logs"
    Invoke-Remoto $cfg "echo '--- web ---'; docker logs --tail $Lineas comercial-web; echo '--- worker ---'; docker logs --tail $Lineas comercial-worker"

    Write-Paso 5 'Últimas cargas desde GHL'
    Invoke-Remoto $cfg 'docker exec comercial-worker node dist/cli.js estado' -PermitirFallo
}
