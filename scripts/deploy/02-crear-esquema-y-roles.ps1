<#
.SYNOPSIS
  Levanta el PostgreSQL propio (comercial-db) y crea los esquemas comercial y comercial_cola y los
  3 roles. Idempotente: se puede repetir sin efectos.
.DESCRIPTION
  La base es propia de Driven Comercial (no es la de DrivenBox ni la de Driven Conteo). El script se
  conecta como administrador por el socket local del contenedor, así que no hace falta escribir su
  contraseña. Las contraseñas de los roles se leen del .env del servidor y viajan a psql por la
  entrada estándar: nunca pasan por tu PC ni por la línea de comandos.
.EXAMPLE
  .\02-crear-esquema-y-roles.ps1
#>
[CmdletBinding()]
param([string]$Config = (Join-Path $PSScriptRoot 'config.psd1'))
. "$PSScriptRoot\comun.ps1"

Invoke-Script '02 · Crear esquemas y roles' {
    $cfg = Import-ConfigDespliegue $Config

    Write-Paso 1 'Confirmación'
    Write-Host '    Se creará (o actualizará) en el PostgreSQL PROPIO de Driven Comercial (contenedor comercial-db):'
    Write-Host '      - esquemas comercial y comercial_cola'
    Write-Host '      - roles comercial_migrador, comercial_worker y comercial_web'
    Write-Host '    No se toca drivenbox-db ni ninguna otra base, contenedor o red del servidor.'
    if (-not (Confirm-Accion '¿Continuar?')) { throw 'Cancelado por el usuario.' }

    Write-Paso 2 'Levantar comercial-db'
    Invoke-Remoto $cfg @"
[ -f .env ] || { echo 'Falta .env: ejecuta antes 01-preparar-servidor.ps1'; exit 1; }
docker compose up -d db
$(Get-BashEsperarSalud 'comercial-db' 120)
"@
    Write-Ok 'comercial-db en marcha'

    Write-Paso 3 'Ejecutar sql/esquema_y_roles.sql'
    Invoke-Remoto $cfg @'
clave() { sed -n "s#^$1=postgres://[^:]*:\([^@]*\)@.*#\1#p" .env | head -n1; }
mig=$(clave DATABASE_URL_MIGRADOR); wrk=$(clave DATABASE_URL_WORKER); web=$(clave DATABASE_URL)
if [ -z "$mig" ] || [ -z "$wrk" ] || [ -z "$web" ]; then echo 'No se encontraron las contraseñas de los roles en .env'; exit 1; fi
{
  printf "\\set clave_migrador '%s'\n\\set clave_worker '%s'\n\\set clave_web '%s'\n" "$mig" "$wrk" "$web"
  cat sql/esquema_y_roles.sql
} | docker exec -i comercial-db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d comercial
'@
    Write-Ok 'Esquemas y roles listos'

    Write-Paso 4 'Comprobar'
    Invoke-Remoto $cfg @'
docker exec comercial-db psql -X -At -U postgres -d comercial -c "select 'roles: ' || count(*) from pg_roles where rolname in ('comercial_migrador','comercial_worker','comercial_web')"
docker exec comercial-db psql -X -At -U postgres -d comercial -c "select 'esquemas: ' || string_agg(nspname, ', ' order by nspname) from pg_namespace where nspname in ('comercial','comercial_cola')"
'@
    Write-Ok 'Siguiente: .\03-desplegar.ps1'
}
