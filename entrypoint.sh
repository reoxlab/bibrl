#!/bin/sh
set -eu

BRAND_LINK=0
case "${BIBRL_BRAND_LINK:-0}" in
  1|true|TRUE|True)
    BRAND_LINK=1
    ;;
  *)
    BRAND_LINK=0
    ;;
esac

cat <<EOF > /usr/share/nginx/html/config.js
window.BIBRL_CONFIG = { brandLink: ${BRAND_LINK} };
EOF
# nginx sirve como usuario nginx: el archivo debe ser legible por todos.
chmod 644 /usr/share/nginx/html/config.js

# Usar los DNS reales del contenedor (/etc/resolv.conf: 127.0.0.11 en redes Docker
# de usuario como sky-net, o el DNS del host en el bridge por defecto).
DNS_SERVERS=$(awk '/^nameserver[[:space:]]+/ { ip=$2; if (ip ~ /:/) ip="[" ip "]"; printf "%s ", ip }' /etc/resolv.conf | sed 's/[[:space:]]*$//')
if [ -n "$DNS_SERVERS" ]; then
  sed -i "s|resolver 127\.0\.0\.11 valid=30s;|resolver ${DNS_SERVERS} valid=30s;|g" /etc/nginx/conf.d/default.conf
fi

exec nginx -g 'daemon off;'
