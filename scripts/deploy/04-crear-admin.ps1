<#
.SYNOPSIS
  Crea un administrador dentro del contenedor web. Muestra su contraseña temporal UNA sola vez.
.EXAMPLE
  .\04-crear-admin.ps1 -Correo admin@empresa.com -Nombre "Nombre Apellido"
#>
[CmdletBinding()]
param(
    [string]$Config = (Join-Path $PSScriptRoot 'config.psd1'),
    [string]$Correo,
    [string]$Nombre
)
. "$PSScriptRoot\comun.ps1"

Invoke-Script '04 · Crear administrador' {
    $cfg = Import-ConfigDespliegue $Config
    if (-not $Correo) { $Correo = Read-Host 'Correo del administrador' }
    if (-not $Nombre) { $Nombre = Read-Host 'Nombre y apellido' }
    if ($Correo -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw 'Correo inválido.' }
    if ([string]::IsNullOrWhiteSpace($Nombre)) { throw 'El nombre es obligatorio.' }

    Write-Paso 1 'Crear el usuario'
    Invoke-Remoto $cfg "docker exec comercial-web node apps/web/cli/crear-admin.mjs --correo $(ConvertTo-Bash $Correo.Trim()) --nombre $(ConvertTo-Bash $Nombre.Trim())"
    Write-Ok "Ingresa en https://$($cfg.Dominio) con ese correo y la contraseña temporal; se pedirá cambiarla."
}
