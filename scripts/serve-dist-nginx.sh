#!/usr/bin/env bash
# Serve dist/ with one of the repo's nginx configs, the way its image does,
# so e2e runs under the real deploy headers (plan 0.20).
#
#   scripts/serve-dist-nginx.sh docker|deploy PORT
#
# docker: docker/nginx.conf (on-prem web shell, docker/Dockerfile.web)
# deploy: deploy/nginx.conf + deploy/lumen-runtime-headers.conf (root Dockerfile)
#
# The endpoint placeholder is filled from dist/.csp-connect-extra, as both
# Dockerfiles do. Runs nginx as the current user from a temporary prefix;
# prints the prefix (stop with: nginx -p PREFIX -c PREFIX/nginx.conf -s stop).
set -euo pipefail
conf=${1:?docker or deploy}
port=${2:?port}
root=$(cd "$(dirname "$0")/.." && pwd)
dist="$root/dist"
[ -f "$dist/index.html" ] || { echo "no $dist/index.html: build first" >&2; exit 1; }
extra=$(cat "$dist/.csp-connect-extra" 2>/dev/null || true)
p=$(mktemp -d)
mkdir -p "$p/logs"
temps="client_body_temp_path $p; proxy_temp_path $p; fastcgi_temp_path $p; uwsgi_temp_path $p; scgi_temp_path $p;"

fill() { sed -e "s#__CSP_CONNECT_EXTRA__#${extra}#" -e "s#/usr/share/nginx/html#${dist}#"; }

case "$conf" in
  docker)
    fill < "$root/docker/nginx.conf" | sed -e "s#listen 80;#listen ${port};#" > "$p/default.conf"
    cat > "$p/nginx.conf" <<EOF
error_log $p/logs/error.log warn;
pid $p/nginx.pid;
events {}
http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  access_log off;
  $temps
  include $p/default.conf;
}
EOF
    ;;
  deploy)
    fill < "$root/deploy/lumen-runtime-headers.conf" > "$p/lumen-runtime-headers.conf"
    fill < "$root/deploy/nginx.conf" | sed \
      -e "s#^error_log .*#error_log $p/logs/error.log warn;#" \
      -e "s#^pid .*#pid $p/nginx.pid;#" \
      -e "s#/etc/nginx/lumen-runtime-headers.conf#$p/lumen-runtime-headers.conf#" \
      -e "s#listen 8080;#listen ${port};#" \
      -e "s#^http {#http {\n    access_log off;\n    $temps#" > "$p/nginx.conf"
    ;;
  *) echo "unknown config: $conf" >&2; exit 1 ;;
esac

nginx -t -q -e "$p/logs/error.log" -p "$p" -c "$p/nginx.conf"
nginx -e "$p/logs/error.log" -p "$p" -c "$p/nginx.conf"
for _ in $(seq 1 30); do
  curl -sf -o /dev/null "http://localhost:${port}/" && { echo "$p"; exit 0; }
  sleep 0.5
done
echo "nginx did not come up on :${port}" >&2
cat "$p/logs/error.log" >&2
exit 1
