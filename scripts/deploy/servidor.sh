#!/usr/bin/env bash
# =====================================================================================
# Driven Comercial · despliegue desde la terminal del servidor (como root).
# Alternativa a los scripts de PowerShell cuando se trabaja directamente en el servidor:
# construye las imágenes ahí mismo con el código clonado en /opt/driven-comercial/codigo.
#
#   bash servidor.sh preparar        carpeta, docker-compose y .env (secretos generados aquí, permisos 600)
#   bash servidor.sh base            PostgreSQL propio, esquemas y roles (idempotente)
#   bash servidor.sh desplegar       construye las imágenes del commit actual, migra y levanta
#   bash servidor.sh admin CORREO "NOMBRE"
#   bash servidor.sh verificar       contenedores, salud, HTTPS, logs y cargas
#   bash servidor.sh actualizar      git pull + desplegar
#   bash servidor.sh revertir        vuelve a la versión anterior
#   bash servidor.sh respaldo        pg_dump del esquema comercial en /opt/driven-comercial/respaldos
#   bash servidor.sh historico [DIAS] [LOCATION_ID]
#
# No toca contenedores, redes ni bases de otras aplicaciones. Solo usa la red "web" de Traefik.
# =====================================================================================
set -Eeuo pipefail

RUTA="${RUTA_COMERCIAL:-/opt/driven-comercial}"
CODIGO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOMINIO="${DOMINIO_COMERCIAL:-comercial.drivenbox.drivenautomations.com}"
RED_TRAEFIK="${RED_TRAEFIK:-web}"
PUERTO_WEB="${PUERTO_WEB_COMERCIAL:-3100}"
IMAGEN_WEB_LOCAL=driven-comercial-web
IMAGEN_WORKER_LOCAL=driven-comercial-worker
RESPALDOS_A_CONSERVAR=7

paso() { printf '\n\033[36m[%s] %s\033[0m\n' "$1" "$2"; }
ok() { printf '    \033[32mOK\033[0m  %s\n' "$*"; }
aviso() { printf '    \033[33mAVISO\033[0m  %s\n' "$*"; }
fallo() { printf '\n\033[31mFALLÓ: %s\033[0m\n' "$*" >&2; exit 1; }
listo() { printf '\n\033[32mLISTO: %s\033[0m\n' "$*"; }
trap 'printf "\n\033[31mFALLÓ en la línea %s: %s\033[0m\n" "$LINENO" "$BASH_COMMAND" >&2' ERR

confirmar() { local r; read -r -p "    $1 Escribe SI para continuar: " r; [ "$r" = SI ]; }
env_valor() { sed -n "s/^$1=//p" "$RUTA/.env" | head -n1; }
fijar_env() { if grep -q "^$1=" "$RUTA/.env"; then sed -i "s|^$1=.*|$1=$2|" "$RUTA/.env"; else echo "$1=$2" >> "$RUTA/.env"; fi; }
compose() { (cd "$RUTA" && docker compose "$@"); }
exigir_preparado() { [ -f "$RUTA/.env" ] && [ -f "$RUTA/docker-compose.yml" ] || fallo "Falta $RUTA/.env: ejecuta antes 'bash servidor.sh preparar'."; }

esperar_salud() {
  local c="$1" limite="$2" t=0 estado
  while [ "$t" -lt "$limite" ]; do
    estado=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo ausente)
    if [ "$estado" = healthy ]; then echo "    $c: healthy"; return 0; fi
    if [ "$estado" = unhealthy ] || [ "$estado" = exited ]; then docker logs --tail 40 "$c"; fallo "$c quedó $estado."; fi
    sleep 3; t=$((t + 3))
  done
  docker logs --tail 40 "$c"; fallo "$c no quedó saludable en $limite s (estado: $estado)."
}

esperar_worker() {
  local t=0 reinicios
  until docker logs comercial-worker 2>&1 | grep -q '"evento":"worker_iniciado"'; do
    reinicios=$(docker inspect -f '{{.RestartCount}}' comercial-worker)
    if [ "$reinicios" -gt 0 ] || [ "$t" -ge 90 ]; then docker logs --tail 40 comercial-worker; fallo "comercial-worker no arrancó (reinicios: $reinicios)."; fi
    sleep 3; t=$((t + 3))
  done
  echo "    comercial-worker: iniciado"
}

salud_web() { docker exec comercial-web wget -qO- http://127.0.0.1:3100/api/salud; echo; }

# ------------------------------------------------------------------------------------- preparar
cmd_preparar() {
  paso 1 "Carpeta $RUTA"
  mkdir -p "$RUTA/sql" "$RUTA/respaldos"; chmod 750 "$RUTA"; chmod 700 "$RUTA/respaldos"
  ok 'Carpeta lista'

  paso 2 'docker-compose.yml y SQL de esquemas y roles'
  cp "$CODIGO/docker/docker-compose.prod.yml" "$RUTA/docker-compose.yml"
  cp "$CODIGO/scripts/sql/esquema_y_roles.sql" "$RUTA/sql/esquema_y_roles.sql"
  ok 'Copiados desde el código'

  paso 3 'Archivo .env'
  if [ -f "$RUTA/.env" ]; then
    ok '.env ya existe: se conserva (tiene la clave que descifra los tokens de GHL).'
  else
    local anthropic=''
    read -r -s -p '    Clave de la API de Anthropic (no se ve al escribir; Enter para dejarla vacía): ' anthropic; echo
    case "$anthropic" in *[[:space:]\'\"\$\`\\]*) fallo 'La clave no puede tener espacios, comillas ni símbolos $ ` \.';; esac
    local pg mig wrk web
    pg=$(openssl rand -hex 24); mig=$(openssl rand -hex 24); wrk=$(openssl rand -hex 24); web=$(openssl rand -hex 24)
    ( umask 077
      cat > "$RUTA/.env.nuevo" <<FIN_ENV
# Generado por scripts/deploy/servidor.sh. Permisos 600. No copiar fuera del servidor.
POSTGRES_PASSWORD=$pg
DATABASE_URL=postgres://comercial_web:$web@comercial-db:5432/comercial
DATABASE_URL_WORKER=postgres://comercial_worker:$wrk@comercial-db:5432/comercial
DATABASE_URL_MIGRADOR=postgres://comercial_migrador:$mig@comercial-db:5432/comercial
CLAVE_CIFRADO=$(openssl rand -base64 32)
SESION_SECRETO=$(openssl rand -hex 32)
URL_PUBLICA=https://$DOMINIO
GHL_URL_APP=https://app.gohighlevel.com
SYNC_NOCTURNO_HORA=02:30
SYNC_INCREMENTAL_MINUTOS=15
GHL_MAX_LLAMADAS_10S=80
ANTHROPIC_API_KEY=$anthropic
IA_MODELO=claude-haiku-5-5
IA_ESFUERZO=low
IA_PENSAMIENTO=no
IA_TOPE_MENSUAL_USD=10
CALIDAD_MUESTRA_CONVERSACIONES=1000
CALIDAD_MAX_MENSAJES_CONVERSACION=10
CALIDAD_MAX_MANUALES_MES=3
CALIDAD_SALUDOS_POR_REGLA=si
MODO_ALERTAS=sombra
ZONA_HORARIA_DEFECTO=America/Lima
PUERTO_WEB=$PUERTO_WEB
DOMINIO=$DOMINIO
LOG_NIVEL=info
IMAGEN_WEB=$IMAGEN_WEB_LOCAL
IMAGEN_WORKER=$IMAGEN_WORKER_LOCAL
ETIQUETA=sin-desplegar
FIN_ENV
      chmod 600 "$RUTA/.env.nuevo"; mv "$RUTA/.env.nuevo" "$RUTA/.env" )
    anthropic=''; pg=''; mig=''; wrk=''; web=''
    ok ".env generado con permisos $(stat -c %a "$RUTA/.env"). La CLAVE_CIFRADO vive solo aquí: no lo borres."
  fi

  paso 4 "Red de Traefik '$RED_TRAEFIK'"
  docker network inspect "$RED_TRAEFIK" >/dev/null 2>&1 || fallo "No existe la red '$RED_TRAEFIK' de Traefik."
  ok 'Existe (no se modifica)'
  listo "Servidor preparado. Siguiente: bash $0 base"
}

# ------------------------------------------------------------------------------------- base
cmd_base() {
  exigir_preparado
  paso 1 'Confirmación'
  echo '    Se creará (o actualizará) en el PostgreSQL PROPIO de Driven Comercial (contenedor comercial-db):'
  echo '      esquemas comercial y comercial_cola; roles comercial_migrador, comercial_worker y comercial_web.'
  echo '    No se toca drivenbox-db ni ninguna otra base, contenedor o red.'
  confirmar '¿Continuar?' || fallo 'Cancelado.'

  paso 2 'Levantar comercial-db'
  cp "$CODIGO/scripts/sql/esquema_y_roles.sql" "$RUTA/sql/esquema_y_roles.sql"
  compose up -d db
  esperar_salud comercial-db 120

  paso 3 'Esquemas y roles'
  local mig wrk web
  mig=$(env_valor DATABASE_URL_MIGRADOR | sed -n 's#^postgres://[^:]*:\([^@]*\)@.*#\1#p')
  wrk=$(env_valor DATABASE_URL_WORKER | sed -n 's#^postgres://[^:]*:\([^@]*\)@.*#\1#p')
  web=$(env_valor DATABASE_URL | sed -n 's#^postgres://[^:]*:\([^@]*\)@.*#\1#p')
  [ -n "$mig" ] && [ -n "$wrk" ] && [ -n "$web" ] || fallo 'No se encontraron las contraseñas de los roles en .env.'
  { printf "\\set clave_migrador '%s'\n\\set clave_worker '%s'\n\\set clave_web '%s'\n" "$mig" "$wrk" "$web"
    cat "$RUTA/sql/esquema_y_roles.sql"
  } | docker exec -i comercial-db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d comercial
  docker exec comercial-db psql -X -At -U postgres -d comercial -c "select '    roles: ' || count(*) from pg_roles where rolname in ('comercial_migrador','comercial_worker','comercial_web')"
  docker exec comercial-db psql -X -At -U postgres -d comercial -c "select '    esquemas: ' || string_agg(nspname, ', ' order by nspname) from pg_namespace where nspname in ('comercial','comercial_cola')"
  listo "Base lista. Siguiente: bash $0 desplegar"
}

# ------------------------------------------------------------------------------------- desplegar
cmd_desplegar() {
  exigir_preparado
  local omitir_build=no etiqueta
  [ "${1:-}" = --omitir-build ] && omitir_build=si
  etiqueta=$(git -C "$CODIGO" rev-parse --short HEAD)
  [ -z "$(git -C "$CODIGO" status --porcelain --untracked-files=no)" ] || aviso 'El código tiene cambios sin confirmar: se despliegan tal cual.'
  local web="$IMAGEN_WEB_LOCAL:$etiqueta" worker="$IMAGEN_WORKER_LOCAL:$etiqueta"

  paso 1 "Imágenes del commit $etiqueta ($(git -C "$CODIGO" log -1 --format=%s | cut -c1-70))"
  if [ "$omitir_build" = si ]; then
    docker image inspect "$web" "$worker" >/dev/null || fallo "No existen las imágenes $web y $worker."
    ok 'Se usan las imágenes ya construidas'
  else
    echo '    Construyendo la web (puede tardar varios minutos)…'
    docker build -q -f "$CODIGO/docker/web.Dockerfile" -t "$web" "$CODIGO" >/dev/null
    echo '    Construyendo el worker…'
    docker build -q -f "$CODIGO/docker/worker.Dockerfile" -t "$worker" "$CODIGO" >/dev/null
    ok "Imágenes $web y $worker"
  fi

  paso 2 'Guardar la versión actual para poder revertir'
  local actual; actual=$(env_valor ETIQUETA)
  if docker ps -a --format '{{.Names}}' | grep -qx comercial-web; then
    docker tag "$(docker inspect -f '{{.Image}}' comercial-web)" "$IMAGEN_WEB_LOCAL:anterior"
    docker tag "$(docker inspect -f '{{.Image}}' comercial-worker)" "$IMAGEN_WORKER_LOCAL:anterior"
    [ "$actual" = anterior ] || echo "$actual" > "$RUTA/.etiqueta-anterior"
    ok "Versión anterior guardada: $(cat "$RUTA/.etiqueta-anterior")"
  else
    ok 'Primera instalación: no hay versión anterior.'
  fi
  fijar_env IMAGEN_WEB "$IMAGEN_WEB_LOCAL"
  fijar_env IMAGEN_WORKER "$IMAGEN_WORKER_LOCAL"
  fijar_env ETIQUETA "$etiqueta"

  paso 3 'Base de datos y migraciones'
  compose up -d db
  esperar_salud comercial-db 120
  [ "$(docker exec comercial-db psql -X -At -U postgres -d comercial -c "select count(*) from pg_roles where rolname in ('comercial_migrador','comercial_worker','comercial_web')")" = 3 ] \
    || fallo "Faltan los roles: ejecuta antes 'bash $0 base'."
  compose run --rm --no-deps worker node dist/migrar.js

  paso 4 'Levantar web y worker'
  compose up -d web worker
  esperar_salud comercial-web 180
  esperar_worker

  paso 5 'Healthcheck'
  salud_web
  listo "Driven Comercial $etiqueta desplegado: https://$DOMINIO  (si algo falla: bash $0 revertir)"
}

cmd_actualizar() {
  paso 0 'Traer el código nuevo (git pull)'
  git -C "$CODIGO" pull --ff-only
  cmd_desplegar "$@"
}

# ------------------------------------------------------------------------------------- admin
cmd_admin() {
  local correo="${1:-}" nombre="${2:-}"
  [ -n "$correo" ] || read -r -p '    Correo del administrador: ' correo
  [ -n "$nombre" ] || read -r -p '    Nombre y apellido: ' nombre
  [[ "$correo" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || fallo 'Correo inválido.'
  [ -n "$nombre" ] || fallo 'El nombre es obligatorio.'
  paso 1 'Crear el administrador'
  docker exec comercial-web node apps/web/cli/crear-admin.mjs --correo "$correo" --nombre "$nombre"
  listo "Ingresa en https://$DOMINIO con ese correo y la contraseña temporal; se pedirá cambiarla."
}

# ------------------------------------------------------------------------------------- verificar
cmd_verificar() {
  exigir_preparado
  paso 1 'Contenedores'
  compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Image}}'
  echo "    Versión desplegada: $(env_valor ETIQUETA)"
  [ -f "$RUTA/.etiqueta-anterior" ] && echo "    Versión anterior (para revertir): $(cat "$RUTA/.etiqueta-anterior")"
  paso 2 'Salud de la web'
  salud_web
  paso 3 "HTTPS (https://$DOMINIO)"
  local codigo; codigo=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMINIO/api/salud" || true)
  if [ "$codigo" = 200 ]; then ok 'HTTPS responde 200'; else aviso "HTTPS respondió '$codigo'. En una instalación nueva el certificado tarda 1–2 minutos."; fi
  paso 4 'Últimas líneas de logs'
  echo '--- web ---'; docker logs --tail 15 comercial-web 2>&1
  echo '--- worker ---'; docker logs --tail 15 comercial-worker 2>&1
  paso 5 'Últimas cargas desde GHL'
  docker exec comercial-worker node dist/cli.js estado || true
  listo 'Verificación terminada.'
}

# ------------------------------------------------------------------------------------- revertir
cmd_revertir() {
  exigir_preparado
  docker image inspect "$IMAGEN_WEB_LOCAL:anterior" "$IMAGEN_WORKER_LOCAL:anterior" >/dev/null 2>&1 \
    || fallo 'No hay una versión anterior guardada (se guarda al desplegar una actualización).'
  local anterior; anterior=$(cat "$RUTA/.etiqueta-anterior" 2>/dev/null || echo desconocida)
  paso 1 "Volver a la versión $anterior"
  confirmar '¿Revertir web y worker?' || fallo 'Cancelado.'
  fijar_env ETIQUETA anterior
  compose up -d web worker
  esperar_salud comercial-web 180
  salud_web
  listo "Revertido a $anterior. Para volver a la nueva: bash $0 desplegar"
}

# ------------------------------------------------------------------------------------- respaldo
cmd_respaldo() {
  exigir_preparado
  paso 1 'Respaldo del esquema comercial'
  mkdir -p "$RUTA/respaldos"; chmod 700 "$RUTA/respaldos"
  local f; f="$RUTA/respaldos/comercial-$(date +%Y%m%d-%H%M%S).dump"
  docker exec comercial-db pg_dump -U postgres -d comercial -n comercial -Fc -Z 9 > "$f.tmp"
  mv "$f.tmp" "$f"; chmod 600 "$f"
  ls -1t "$RUTA"/respaldos/comercial-*.dump | tail -n +$((RESPALDOS_A_CONSERVAR + 1)) | xargs -r rm -f
  ok "$f ($(du -h "$f" | cut -f1)). Se conservan los últimos $RESPALDOS_A_CONSERVAR."
  listo 'Respaldo creado. Contiene datos sensibles: si lo copias fuera del servidor, guárdalo en un lugar seguro.'
}

# ------------------------------------------------------------------------------------- historico
cmd_historico() {
  local dias="${1:-90}" sub="${2:-}"
  [[ "$dias" =~ ^[0-9]+$ ]] && [ "$dias" -ge 1 ] && [ "$dias" -le 365 ] || fallo 'DIAS debe estar entre 1 y 365.'
  [ -z "$sub" ] || [[ "$sub" =~ ^[A-Za-z0-9_-]+$ ]] || fallo 'locationId inválido.'
  paso 1 "Carga histórica de $dias días (solo lectura sobre GHL)"
  if [ -n "$sub" ]; then docker exec comercial-worker node dist/cli.js historico --dias "$dias" --subcuenta "$sub"
  else docker exec comercial-worker node dist/cli.js historico --dias "$dias"; fi
  listo 'Carga encolada. Avance: docker logs -f comercial-worker'
}

ayuda() { sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'; }

comando="${1:-ayuda}"; shift || true
case "$comando" in
  preparar) cmd_preparar ;;
  base) cmd_base ;;
  desplegar) cmd_desplegar "$@" ;;
  actualizar) cmd_actualizar "$@" ;;
  admin) cmd_admin "$@" ;;
  verificar) cmd_verificar ;;
  revertir) cmd_revertir ;;
  respaldo) cmd_respaldo ;;
  historico) cmd_historico "$@" ;;
  *) ayuda ;;
esac
