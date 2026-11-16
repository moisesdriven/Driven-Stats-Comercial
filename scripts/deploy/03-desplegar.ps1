<#
.SYNOPSIS
  Despliega (o actualiza) Driven Comercial: imágenes, migraciones, servicios y healthcheck.
.PARAMETER Origen
  GHCR  = descarga en el servidor las imágenes publicadas por GitHub Actions (recomendado).
  Local = construye las imágenes en tu PC (Docker Desktop), las envía con scp y las carga con docker load.
.PARAMETER Etiqueta
  Etiqueta de las imágenes. Por defecto la de config.psd1 (GHCR) o el commit actual + "-local" (Local).
.PARAMETER OmitirBuild
  Con -Origen Local: usa imágenes ya construidas en tu PC con esa etiqueta.
.EXAMPLE
  .\03-desplegar.ps1
.EXAMPLE
  .\03-desplegar.ps1 -Origen GHCR -Etiqueta 4ee491c
.EXAMPLE
  .\03-desplegar.ps1 -Origen Local
#>
[CmdletBinding()]
param(
    [string]$Config = (Join-Path $PSScriptRoot 'config.psd1'),
    [ValidateSet('GHCR', 'Local')] [string]$Origen = 'GHCR',
    [string]$Etiqueta,
    [switch]$OmitirBuild
)
. "$PSScriptRoot\comun.ps1"

Invoke-Script '03 · Desplegar' {
    $cfg = Import-ConfigDespliegue $Config
    if (-not $Etiqueta) {
        if ($Origen -eq 'Local') {
            $sha = (& git -C $script:RaizRepo rev-parse --short HEAD).Trim()
            if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer el commit con git.' }
            $Etiqueta = "$sha-local"
        } else { $Etiqueta = $cfg.Etiqueta }
    }
    if ($Etiqueta -notmatch '^[A-Za-z0-9._-]+$' -or $Etiqueta -eq 'anterior') { throw "Etiqueta inválida: $Etiqueta" }
    $web = "$($cfg.ImagenWeb):$Etiqueta"
    $worker = "$($cfg.ImagenWorker):$Etiqueta"

    Write-Paso 1 'Comprobar que el servidor está preparado'
    Invoke-Remoto $cfg @"
[ -f .env ] && [ -f docker-compose.yml ] || { echo 'Falta .env o docker-compose.yml: ejecuta 01-preparar-servidor.ps1'; exit 1; }
echo "Desplegando $Etiqueta (origen $Origen)"
"@

    if ($Origen -eq 'Local') {
        Write-Paso 2 'Construir y enviar las imágenes desde esta PC'
        if (-not $OmitirBuild) {
            foreach ($par in @(@('web', $web), @('worker', $worker))) {
                Write-Host "    docker build ($($par[0]))…"
                & docker build -f (Join-Path $script:RaizRepo "docker\$($par[0]).Dockerfile") -t $par[1] $script:RaizRepo
                if ($LASTEXITCODE -ne 0) { throw "Falló la construcción de la imagen $($par[0])." }
            }
        }
        $tar = Join-Path ([IO.Path]::GetTempPath()) "driven-comercial-$Etiqueta.tar"
        & docker save -o $tar $web $worker
        if ($LASTEXITCODE -ne 0) { throw 'Falló docker save.' }
        try {
            Write-Host "    Enviando $([math]::Round((Get-Item $tar).Length / 1MB)) MB…"
            Send-Archivo $cfg $tar "$($cfg.RutaRemota)/imagenes.tar"
        } finally { Remove-Item $tar -Force -ErrorAction SilentlyContinue }
        Invoke-Remoto $cfg 'docker load -i imagenes.tar && rm -f imagenes.tar'
    } else {
        Write-Paso 2 'Descargar las imágenes de GHCR en el servidor'
        Invoke-Remoto $cfg "docker pull $(ConvertTo-Bash $web) && docker pull $(ConvertTo-Bash $worker)"
    }
    Write-Ok 'Imágenes disponibles en el servidor'

    Write-Paso 3 'Guardar la versión actual para poder revertir'
    Invoke-Remoto $cfg @"
actual=`$(sed -n 's/^ETIQUETA=//p' .env | head -n1)
if docker ps -a --format '{{.Names}}' | grep -qx comercial-web; then
  docker tag "`$(docker inspect -f '{{.Image}}' comercial-web)" $(ConvertTo-Bash "$($cfg.ImagenWeb):anterior")
  docker tag "`$(docker inspect -f '{{.Image}}' comercial-worker)" $(ConvertTo-Bash "$($cfg.ImagenWorker):anterior")
  # Si se había revertido, la versión en marcha es la de .etiqueta-anterior: se conserva ese nombre.
  [ "`$actual" = anterior ] || echo "`$actual" > .etiqueta-anterior
  echo "Versión anterior guardada: `$(cat .etiqueta-anterior)"
else
  echo 'Primera instalación: no hay versión anterior.'
fi
if grep -q '^ETIQUETA=' .env; then sed -i 's/^ETIQUETA=.*/ETIQUETA=$Etiqueta/' .env; else echo 'ETIQUETA=$Etiqueta' >> .env; fi
grep -q '^IMAGEN_WEB=' .env || echo $(ConvertTo-Bash "IMAGEN_WEB=$($cfg.ImagenWeb)") >> .env
grep -q '^IMAGEN_WORKER=' .env || echo $(ConvertTo-Bash "IMAGEN_WORKER=$($cfg.ImagenWorker)") >> .env
"@

    Write-Paso 4 'Base de datos y migraciones'
    Invoke-Remoto $cfg @"
docker compose up -d db
$(Get-BashEsperarSalud 'comercial-db' 120)
roles=`$(docker exec comercial-db psql -X -At -U postgres -d comercial -c "select count(*) from pg_roles where rolname in ('comercial_migrador','comercial_worker','comercial_web')")
[ "`$roles" = 3 ] || { echo 'Faltan los roles: ejecuta antes 02-crear-esquema-y-roles.ps1'; exit 1; }
docker compose run --rm --no-deps worker node dist/migrar.js
"@
    Write-Ok 'Migraciones aplicadas'

    Write-Paso 5 'Levantar web y worker'
    Invoke-Remoto $cfg @"
docker compose up -d web worker
$(Get-BashEsperarSalud 'comercial-web' 180)
# El worker no tiene healthcheck: se espera su evento de inicio y que no se reinicie.
t=0
until docker logs comercial-worker 2>&1 | grep -q '"evento":"worker_iniciado"'; do
  reinicios=`$(docker inspect -f '{{.RestartCount}}' comercial-worker)
  if [ "`$reinicios" -gt 0 ] || [ "`$t" -ge 90 ]; then docker logs --tail 40 comercial-worker; echo "comercial-worker no arrancó (reinicios: `$reinicios)"; exit 1; fi
  sleep 3; t=`$((t + 3))
done
echo "comercial-worker: iniciado"
"@

    Write-Paso 6 'Healthcheck'
    Invoke-Remoto $cfg "docker exec comercial-web wget -qO- http://127.0.0.1:3100/api/salud && echo"
    Write-Ok "Driven Comercial $Etiqueta desplegado: https://$($cfg.Dominio)"
    Write-Host '    Si algo no funciona: .\06-revertir.ps1 vuelve a la versión anterior.'
}
