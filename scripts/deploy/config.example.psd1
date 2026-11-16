# Configuración del despliegue de Driven Comercial.
# Copia este archivo como config.psd1 (en esta misma carpeta) y completa los valores.
# config.psd1 está en .gitignore: nunca lo subas al repositorio. Aquí NO van contraseñas.
@{
    # Servidor (el mismo donde corre Driven Conteo).
    Servidor      = 'IP-O-NOMBRE-DEL-SERVIDOR'
    PuertoSsh     = 22
    Usuario       = 'usuario-ssh'

    # 'ssh' (desde tu PC con Windows) o 'local' (ejecutando los scripts en el propio servidor con PowerShell 7).
    Transporte    = 'ssh'

    # Carpeta del sistema en el servidor.
    RutaRemota    = '/opt/driven-comercial'

    # Dominio publicado por Traefik (con HTTPS de Let's Encrypt).
    Dominio       = 'comercial.drivenbox.drivenautomations.com'

    # Puerto local de la web en el servidor (solo 127.0.0.1, para diagnóstico).
    PuertoWeb     = 3100

    # Imágenes publicadas por GitHub Actions en GHCR.
    ImagenWeb     = 'ghcr.io/moisesdriven/driven-comercial-web'
    ImagenWorker  = 'ghcr.io/moisesdriven/driven-comercial-worker'
    # Etiqueta a desplegar: el commit (recomendado, ej. 'a1b2c3d…') o 'latest'.
    Etiqueta      = 'latest'
    # $true si el repositorio (y por lo tanto las imágenes) es privado: 01-preparar-servidor.ps1
    # pedirá un token de GitHub de solo lectura de paquetes (read:packages).
    RegistroPrivado = $true
    UsuarioGithub   = 'moisesdriven'

    # Red de Traefik que ya existe en el servidor (no se modifica).
    RedTraefik    = 'web'

    # Dónde se guardan en tu PC los respaldos que descarga 07-respaldo.ps1.
    CarpetaRespaldos = '~\Documents\DrivenComercial\respaldos'
    # Respaldos que se conservan en el servidor (los más antiguos se borran).
    RespaldosEnServidor = 7
}
